import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { MockTeacherEngine, type TeacherLessonId, type TeacherLesson } from '@/lib/teacher-engine'

// ─── Types ────────────────────────────────────────────────────────────────────

type AnswerRecord = {
  questionId: string
  questionText: string
  selectedIndex: number
  correctIndex?: number
  isCorrect: boolean
  explanation: string
}

// ─── Engine scoring helpers ───────────────────────────────────────────────────

const LESSON_TOPICS: Record<TeacherLessonId, { areas: string[]; weakAreas: string[] }> = {
  'ai-teacher-demo-lesson-1': {
    areas: ['Network architecture', 'Activation functions', 'Forward propagation'],
    weakAreas: ['Gradient descent math', 'Chain rule intuition'],
  },
  'ai-teacher-demo-lesson-2': {
    areas: ['Loss functions', 'Gradient descent', 'Weight updates'],
    weakAreas: ['Backpropagation depth', 'Learning rate tuning'],
  },
}

/**
 * Derive strong/weak areas and recommendations from per-question results.
 * Uses the MockTeacherEngine to produce per-answer feedback, then groups
 * correct answers into "strong" and wrong answers into "weak".
 */
async function deriveReport(
  lesson: TeacherLesson,
  lessonId: string,
  answers: AnswerRecord[],
  scorePct: number,
) {
  const engine = new MockTeacherEngine()
  const topics = LESSON_TOPICS[lessonId] || { areas: [], weakAreas: [] }

  // Build per-question evaluations
  const evaluations = await Promise.all(
    answers.map((a) => engine.evaluateAnswer(lesson, a.selectedIndex))
  )

  const correctCount  = answers.filter((a) => a.isCorrect).length
  const incorrectAnswers = answers.filter((a) => !a.isCorrect)

  // Strong areas: cycle through known topic areas and assign mastery based on score
  const strong = topics.areas.slice(0, Math.max(1, correctCount)).map((area, i) => ({
    area,
    mastery: Math.min(98, Math.round(scorePct - i * 4 + Math.random() * 6)),
  }))

  // Weak areas: every incorrectly-answered question maps to a weak area
  const weak = incorrectAnswers.map((a, i) => ({
    area: topics.weakAreas[i % Math.max(1, topics.weakAreas.length)] ?? `Question ${a.questionId}`,
    mastery: Math.max(20, Math.round(40 - i * 8 + Math.random() * 15)),
  }))

  // Recommendations from engine reexplanations for wrong answers
  const recommendations: string[] = [
    ...incorrectAnswers.map((a, i) => {
      const ev = evaluations[answers.indexOf(a)]
      return ev.reexplanation.length > 10
        ? ev.reexplanation
        : `Review: ${a.questionText}`
    }),
  ]

  // Always add at least one forward-looking recommendation
  const continuation = await engine.continueLesson(lessonId)
  if (continuation.nextLessonId) {
    const nextLesson = await engine.getLessonById(continuation.nextLessonId)
    recommendations.push(
      `Next: "${nextLesson.title}" — ${nextLesson.objective}`,
    )
  }
  if (recommendations.length === 0) {
    recommendations.push(
      'Great understanding overall. Move on to the next lesson to continue building.',
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
    lessonId: TeacherLessonId
    answers: Array<{ questionId: string; selectedIndex: number }>
    timeSpentSeconds: number
    activityDate?: string
  }

  const { lessonId, answers: rawAnswers, timeSpentSeconds } = body

  // Resolve lesson via engine
  const engine = new MockTeacherEngine()
  const lesson = await engine.getLessonById(lessonId)
  const question = lesson.question

  // Build detailed answer records
  const answerRecords: AnswerRecord[] = rawAnswers.map((a) => {
    const isCorrect = a.selectedIndex === question.correctIndex
    return {
      questionId:    a.questionId,
      questionText:  question.prompt,
      selectedIndex: a.selectedIndex,
      correctIndex:  question.correctIndex,
      isCorrect,
      explanation:   question.explanation,
    }
  })

  const correctCount = answerRecords.filter((a) => a.isCorrect).length
  const total        = answerRecords.length
  const scorePct     = total > 0 ? Math.round((correctCount / total) * 100) : 0

  const minutes = Math.floor(timeSpentSeconds / 60)
  const secs    = timeSpentSeconds % 60
  const timeSpent = minutes > 0 ? `${minutes}m ${secs}s` : `${secs}s`

  const { strong, weak, recommendations } = await deriveReport(lesson, lessonId, answerRecords, scorePct)

  // Resolve the seeded lesson without creating an incomplete database row.
  const { data: lessonRow, error: lessonLookupError } = await supabase
    .from('lessons')
    .select('id')
    .eq('title', lesson.title)
    .eq('is_default', true)
    .limit(1)
    .maybeSingle()

  if (lessonLookupError) {
    console.error('[assessment/POST] Lesson lookup failed:', lessonLookupError.message)
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
    console.error(`[assessment/POST] No default lesson found for engine lesson: ${lessonId}`)
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
