import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

import type { SupabaseClient } from '@supabase/supabase-js'

/** Seeded demo lessons, kept so existing rows and links still resolve. */
const LESSON_KEYS: Record<string, string> = {
  'ai-teacher-demo-lesson-1': 'Introduction to Neural Networks',
  'ai-teacher-demo-lesson-2': 'How Neural Networks Learn',
}

/** Holds the lessons the AI generates, one row per learner. */
const GENERATED_COURSE_TITLE = 'AI-generated lessons'

type LessonProgressRequest = {
  lessonKey: string
  /** Title of a generated lesson. Required for anything outside LESSON_KEYS. */
  lessonTitle?: string
  /** The full AILesson object to persist for generated lessons. */
  lessonPayload?: Record<string, unknown>
  status: 'in_progress' | 'completed'
  progressPercentage?: number
  timeSpentSeconds?: number
  currentSection?: 'teaching' | 'question' | 'answering' | 'evaluating' | 'reexplaining' | 'continuing'
  paused?: boolean
  progressState?: Record<string, unknown>
}

/**
 * Resolves the `lessons` row for a lesson key, creating one when needed.
 *
 * The seeded demo lessons are looked up by title. Everything else is a lesson
 * the AI generated with a title nobody could predict, so it gets a row in the
 * learner's own generated-lessons course. Without this, progress for a
 * generated lesson has no `lesson_id` to hang off and the dashboard — which
 * reads entirely from lesson_progress — stays permanently empty.
 */
async function resolveLessonId(
  supabase: SupabaseClient,
  userId: string,
  lessonKey: string,
  lessonTitle: string | undefined,
  createIfMissing: boolean,
  lessonPayload?: Record<string, unknown>,
): Promise<string | null> {
  // 1. Check if lessonKey is a UUID
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (uuidRegex.test(lessonKey)) {
    const { data } = await supabase
      .from('lessons')
      .select('id')
      .eq('id', lessonKey)
      .eq('created_by', userId)
      .limit(1)
      .maybeSingle()
    if (data) {
      if (lessonPayload) {
        await supabase
          .from('lessons')
          .update({
            content: { engineKey: lessonKey, aiLesson: lessonPayload }
          })
          .eq('id', data.id)
      }
      return data.id as string
    }
  }

  // 2. Fall back to title resolution
  const seededTitle = LESSON_KEYS[lessonKey]

  if (seededTitle) {
    const { data } = await supabase
      .from('lessons')
      .select('id')
      .eq('title', seededTitle)
      .eq('is_default', true)
      .limit(1)
      .maybeSingle()
    if (data) return data.id as string
  }

  const title = lessonTitle?.trim()
  if (!title) return null

  // Find or create this learner's generated-lessons course.
  let courseId: string | null = null
  const { data: course } = await supabase
    .from('courses')
    .select('id')
    .eq('title', GENERATED_COURSE_TITLE)
    .eq('created_by', userId)
    .limit(1)
    .maybeSingle()

  if (course) {
    courseId = course.id as string
  } else if (createIfMissing) {
    const { data: created, error } = await supabase
      .from('courses')
      .insert({
        title: GENERATED_COURSE_TITLE,
        description: 'Lessons Maya generated for you.',
        is_default: false,
        created_by: userId,
      })
      .select('id')
      .single()
    if (error) return null
    courseId = created.id as string
  }

  if (!courseId) return null

  // Enrol the learner in their own course. The learning path and dashboard both
  // read through user_courses, so without this row every generated lesson is
  // invisible to them and only the seeded demo course ever appears.
  await supabase
    .from('user_courses')
    .upsert(
      { user_id: userId, course_id: courseId },
      { onConflict: 'user_id,course_id', ignoreDuplicates: true },
    )

  const { data: existing } = await supabase
    .from('lessons')
    .select('id')
    .eq('course_id', courseId)
    .eq('title', title)
    .limit(1)
    .maybeSingle()

  if (existing) {
    // If the lesson exists but we have a new payload, update it.
    // This fixes the issue where generating the same topic again didn't save the payload.
    if (lessonPayload) {
      await supabase
        .from('lessons')
        .update({
          content: { engineKey: lessonKey, aiLesson: lessonPayload }
        })
        .eq('id', existing.id)
    }
    return existing.id as string
  }
  if (!createIfMissing) return null

  // order_index is unique per course, so continue the sequence.
  const { data: last } = await supabase
    .from('lessons')
    .select('order_index')
    .eq('course_id', courseId)
    .order('order_index', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { data: inserted, error: insertError } = await supabase
    .from('lessons')
    .insert({
      id: uuidRegex.test(lessonKey) ? lessonKey : undefined,
      course_id: courseId,
      title,
      description: 'Generated by the AI teacher.',
      order_index: ((last?.order_index as number | undefined) ?? 0) + 1,
      content: lessonPayload ? { engineKey: lessonKey, aiLesson: lessonPayload } : { engineKey: lessonKey },
      is_default: false,
      created_by: userId,
    })
    .select('id')
    .single()

  if (insertError) return null
  return inserted.id as string
}

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  if (!supabase) return NextResponse.json({ error: 'DB unavailable' }, { status: 503 })

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as LessonProgressRequest

  const lessonId = await resolveLessonId(
    supabase,
    user.id,
    body.lessonKey,
    body.lessonTitle,
    true,
    body.lessonPayload,
  )

  if (!lessonId) {
    return NextResponse.json(
      { error: 'Could not resolve a lesson to record progress against.' },
      { status: 400 },
    )
  }

  const now = new Date().toISOString()
  const progress = {
    user_id: user.id,
    lesson_id: lessonId,
    status: body.status,
    progress_percentage: body.status === 'completed' ? 100 : Math.min(99, Math.max(0, body.progressPercentage ?? 1)),
    completed_at: body.status === 'completed' ? now : null,
    updated_at: now,
    current_section: body.currentSection ?? 'teaching',
    paused: body.paused ?? false,
    progress_state: body.progressState ?? {},
  }

  const { error: progressError } = await supabase
    .from('lesson_progress')
    .upsert(progress, { onConflict: 'user_id,lesson_id' })

  if (progressError) {
    return NextResponse.json({ error: progressError.message }, { status: 500 })
  }

  if (body.status === 'completed') {
    const activityDate = now.slice(0, 10)
    const { data: existingActivity } = await supabase
      .from('learning_activity')
      .select('study_minutes')
      .eq('user_id', user.id)
      .eq('activity_date', activityDate)
      .maybeSingle()

    const studyMinutes = (existingActivity?.study_minutes ?? 0) + Math.max(1, Math.ceil((body.timeSpentSeconds ?? 0) / 60))
    const { error: activityError } = await supabase
      .from('learning_activity')
      .upsert(
        { user_id: user.id, activity_date: activityDate, study_minutes: studyMinutes },
        { onConflict: 'user_id,activity_date' },
      )

    if (activityError) {
      console.error('[lesson progress] Activity update failed:', activityError.message)
    }
  }

  return NextResponse.json({ ok: true })
}

export async function GET(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  if (!supabase) return NextResponse.json({ error: 'DB unavailable' }, { status: 503 })

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const params = new URL(req.url).searchParams
  const lessonKey = params.get('lessonKey') ?? ''
  const lessonTitle = params.get('lessonTitle') ?? undefined

  // Reading progress must never create rows — a lesson the learner has not
  // started simply has none.
  const lessonId = await resolveLessonId(supabase, user.id, lessonKey, lessonTitle, false)
  if (!lessonId) return NextResponse.json({ progress: null })

  const { data: progress } = await supabase
    .from('lesson_progress')
    .select('status, progress_percentage, current_section, paused, progress_state, lessons (content)')
    .eq('user_id', user.id)
    .eq('lesson_id', lessonId)
    .maybeSingle()

  return NextResponse.json({ progress })
}
