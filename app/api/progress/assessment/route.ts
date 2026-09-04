import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

// ─── Types ────────────────────────────────────────────────────────────────────

type SubmittedAnswer = {
  questionId: string
  selectedIndex: number
  correctIndex?: number
  /** The concept the question tested, from the generated lesson. */
  concept?: string
}

type AnswerRecord = {
  questionId: string
  concept: string
  selectedIndex: number
  correctIndex?: number
  isCorrect: boolean
}

/**
 * Builds the report from the concepts the generated lesson actually tested.
 *
 * Previously this scored against two hardcoded demo lessons and invented
 * mastery percentages with Math.random(), so a student who had just finished a
 * Hindi lesson on photosynthesis received a report about gradient descent.
 * Every figure here now comes from what the student answered.
 */
function deriveReport(answers: AnswerRecord[], scorePct: number) {
  const correct = answers.filter((a) => a.isCorrect)
  const incorrect = answers.filter((a) => !a.isCorrect)

  // Mastery is derived from the overall score, not fabricated per area.
  const strong = correct.map((a) => ({
    area: a.concept,
    mastery: Math.max(60, Math.min(98, scorePct)),
  }))

  const weak = incorrect.map((a) => ({
    area: a.concept,
    mastery: Math.max(15, Math.min(50, scorePct)),
  }))

  const recommendations: string[] = incorrect.map(
    (a) => `Revisit ${a.concept} — you answered this one incorrectly.`,
  )

  if (recommendations.length === 0) {
    recommendations.push(
      'Every checkpoint correct. Move on to the next topic to keep building.',
    )
  } else if (incorrect.length === answers.length) {
    recommendations.push(
      'Consider replaying the lesson before the next topic — none of the checkpoints landed yet.',
    )
  }

  return { strong, weak, recommendations }
}

// ─── POST: save assessment ────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  if (!supabase) {
    return NextResponse.json({ error: 'DB unavailable' }, { status: 503 })
  }

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json() as {
    lessonId: string
    lessonTitle?: string
    answers: SubmittedAnswer[]
    timeSpentSeconds: number
    activityDate?: string
  }

  const { lessonId, lessonTitle, answers: rawAnswers, timeSpentSeconds } = body

  // The client sends the correct index and the concept alongside each answer,
  // because only it knows what the AI generated for this particular lesson.
  const answerRecords: AnswerRecord[] = (rawAnswers ?? []).map((a, i) => ({
    questionId: a.questionId,
    concept: a.concept?.trim() || `Checkpoint ${i + 1}`,
    selectedIndex: a.selectedIndex,
    correctIndex: a.correctIndex,
    isCorrect: a.correctIndex !== undefined && a.selectedIndex === a.correctIndex,
  }))

  const correctCount = answerRecords.filter((a) => a.isCorrect).length
  const total        = answerRecords.length
  const scorePct     = total > 0 ? Math.round((correctCount / total) * 100) : 0

  const minutes = Math.floor(timeSpentSeconds / 60)
  const secs    = timeSpentSeconds % 60
  const timeSpent = minutes > 0 ? `${minutes}m ${secs}s` : `${secs}s`

  const { strong, weak, recommendations } = deriveReport(answerRecords, scorePct)

  // Match the `lessons` row the progress route created for this lesson. Seeded
  // demo lessons are default-owned; generated ones belong to the learner.
  const title = lessonTitle?.trim()
  let lessonRow: { id: string } | null = null

  if (title) {
    const { data, error } = await supabase
      .from('lessons')
      .select('id')
      .eq('title', title)
      .order('is_default', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) console.error('[assessment/POST] Lesson lookup failed:', error.message)
    lessonRow = (data as { id: string } | null) ?? null
  }

  // Completing an assessment completes the associated lesson in the learning path.
  if (lessonRow) {
    const { error: progressError } = await supabase
      .from('lesson_progress')
      .upsert(
        {
          user_id:             user.id,
          lesson_id:           lessonRow.id,
          status:              'completed',
          progress_percentage: 100,
          completed_at:        new Date().toISOString(),
          updated_at:          new Date().toISOString(),
        },
        { onConflict: 'user_id,lesson_id' },
      )

    if (progressError) {
      console.error('[assessment/POST] Progress update failed:', progressError.message)
    }
  } else {
    // The result is still saved; it just is not linked to a lesson row, which
    // happens if the assessment is opened without having run the lesson.
    console.warn(`[assessment/POST] No lessons row matched "${title ?? lessonId}"`)
  }

  const activityDate = /^\d{4}-\d{2}-\d{2}$/.test(body.activityDate ?? '')
    ? body.activityDate!
    : new Date().toISOString().slice(0, 10)
  const { data: existingActivity } = await supabase
    .from('learning_activity')
    .select('study_minutes')
    .eq('user_id', user.id)
    .eq('activity_date', activityDate)
    .maybeSingle()

  const studyMinutes = (existingActivity?.study_minutes ?? 0) + Math.max(1, Math.ceil(timeSpentSeconds / 60))
  const { error: activityError } = await supabase
    .from('learning_activity')
    .upsert(
      { user_id: user.id, activity_date: activityDate, study_minutes: studyMinutes },
      { onConflict: 'user_id,activity_date' },
    )

  if (activityError) {
    console.error('[assessment/POST] Activity update failed:', activityError.message)
  }

  // Upsert assessment result (one record per user+lesson; latest wins)
  const { data: result, error } = await supabase
    .from('assessment_results')
    .insert({
      user_id:         user.id,
      lesson_id:       lessonRow?.id ?? null,
      lesson_key:      lessonId,
      score:           scorePct,
      correct:         correctCount,
      total,
      time_spent:      timeSpent,
      answers:         answerRecords,
      strong,
      weak,
      recommendations,
      created_at:      new Date().toISOString(),
    })
    .select()
    .single()

  if (error) {
    // If table doesn't exist yet, return computed result anyway so the UI still works
    console.error('[assessment/POST] DB error:', error.message)
    return NextResponse.json({
      score: scorePct, correct: correctCount, total, timeSpent,
      strong, weak, recommendations,
      _dbError: error.message,
    })
  }

  return NextResponse.json({
    id:              result.id,
    score:           scorePct,
    correct:         correctCount,
    total,
    timeSpent,
    strong,
    weak,
    recommendations,
  })
}

// ─── GET: fetch latest result ─────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  if (!supabase) {
    return NextResponse.json({ error: 'DB unavailable' }, { status: 503 })
  }

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const lessonKey = searchParams.get('lessonId')

  let query = supabase
    .from('assessment_results')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)

  if (lessonKey) {
    query = query.eq('lesson_key', lessonKey)
  }

  const { data, error } = await query.maybeSingle()

  if (error || !data) {
    return NextResponse.json({ result: null })
  }

  return NextResponse.json({ result: data })
}
