'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle,
  Bot,
  Captions,
  Check,
  ChevronRight,
  Circle,
  Lightbulb,
  Loader2,
  Pause,
  Play,
  Radio,
  RefreshCw,
  Sparkles,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { TeacherAvatar } from '@/components/app/teacher-avatar'
import { LessonVideoButton } from '@/components/app/lesson-video-button'
import { useSpeech } from '@/lib/speech/use-speech'
import type {
  AIEvaluation,
  AILesson,
  AIQuestion,
  ChatTurn,
  LearnerPreferences,
  QuestionDifficulty,
} from '@/lib/ai/types'

/** One answered checkpoint, kept to drive difficulty and the weak-concept list. */
type AnsweredCheckpoint = {
  difficulty: QuestionDifficulty
  concept?: string
  correct: boolean
}

const DIFFICULTY_ORDER: QuestionDifficulty[] = ['easy', 'core', 'stretch']

/** Down a step after a mistake, up a step after a correct answer. */
function nextDifficulty(
  current: QuestionDifficulty,
  correct: boolean,
): QuestionDifficulty {
  const i = DIFFICULTY_ORDER.indexOf(current)
  const target = correct ? i + 1 : i - 1
  return DIFFICULTY_ORDER[Math.max(0, Math.min(DIFFICULTY_ORDER.length - 1, target))]!
}

const DIFFICULTY_LABEL: Record<QuestionDifficulty, string> = {
  easy: 'Warm-up',
  core: 'Core concept',
  stretch: 'Application',
}

type LessonPhase =
  | 'teaching'
  | 'question'
  | 'answering'
  | 'evaluating'
  | 'reexplaining'
  | 'continuing'

type ResponseMode = 'mcq' | 'freeform'

type LoadState = 'loading' | 'ready' | 'error'

type LessonSession = {
  topic: string
  /** Uploaded material ids. Retrieval is skipped entirely when this is empty. */
  materialIds?: string[]
  preferences: LearnerPreferences
}

const SESSION_KEY = 'lumina_lesson_session'
/** Written by /lesson-plan so the classroom does not regenerate the same lesson. */
const LESSON_CACHE_KEY = 'lumina_active_lesson'

/**
 * Must match sessionSignature in /lesson-plan — a cached lesson is only valid
 * while every learner choice behind it is unchanged, language included.
 */
function sessionSignature(s: LessonSession): string {
  return [
    s.topic.trim(),
    s.preferences.language,
    s.preferences.level,
    s.preferences.goal,
    s.preferences.timeMinutes,
    [...(s.materialIds ?? [])].sort().join(','),
  ].join('|')
}

const DEFAULT_SESSION: LessonSession = {
  topic: 'Introduction to Neural Networks',
  preferences: {
    level: 'Beginner',
    language: 'English',
    goal: 'General curiosity',
    timeMinutes: 20,
  },
}

/** The model returns visuals as fenced markdown; strip the fence for display. */
function stripFence(payload?: string): { language: string; body: string } | null {
  if (!payload?.trim()) return null
  const match = payload.trim().match(/^```(\w*)\n?([\s\S]*?)```$/)
  if (!match) return { language: '', body: payload.trim() }
  return { language: match[1] ?? '', body: (match[2] ?? '').trimEnd() }
}

/** Split Maya's teaching narrative into readable paragraphs. */
function toParagraphs(text?: string): string[] {
  if (!text) return []
  return text.split(/\n{2,}|\n/).map((p) => p.trim()).filter(Boolean)
}

function readSession(): LessonSession {
  if (typeof window === 'undefined') return DEFAULT_SESSION
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    if (!raw) return DEFAULT_SESSION
    const parsed = JSON.parse(raw) as Partial<LessonSession>
    if (!parsed.topic || !parsed.preferences) return DEFAULT_SESSION
    return {
      topic: parsed.topic,
      materialIds: parsed.materialIds ?? [],
      preferences: parsed.preferences,
    }
  } catch {
    return DEFAULT_SESSION
  }
}

export default function ClassroomPage() {
  const router = useRouter()

  // ── Lesson data ─────────────────────────────────────────────────────────────
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [loadError, setLoadError] = useState<string>('')
  const [lesson, setLesson] = useState<AILesson | null>(null)
  const [session, setSession] = useState<LessonSession>(DEFAULT_SESSION)
  const [previousTopics, setPreviousTopics] = useState<string[]>([])
  const [lessonIndex, setLessonIndex] = useState(0)

  // ── Interaction ─────────────────────────────────────────────────────────────
  const [playing, setPlaying] = useState(true)
  const [paused, setPaused] = useState(false)
  const [phase, setPhase] = useState<LessonPhase>('teaching')
  const [responseMode, setResponseMode] = useState<ResponseMode>('mcq')
  const [selected, setSelected] = useState<number | null>(null)
  const [shortAnswer, setShortAnswer] = useState('')
  const [showTranscript, setShowTranscript] = useState(false)
  const [showAskPanel, setShowAskPanel] = useState(false)
  const [resumePhase, setResumePhase] = useState<LessonPhase>('teaching')
  const [askDraft, setAskDraft] = useState('')

  // ── Ask Maya ────────────────────────────────────────────────────────────────
  const [askThread, setAskThread] = useState<ChatTurn[]>([])
  const [askSending, setAskSending] = useState(false)
  const [askError, setAskError] = useState('')
  const [followUps, setFollowUps] = useState<string[]>([])

  // ── Evaluation ──────────────────────────────────────────────────────────────
  const [evaluation, setEvaluation] = useState<AIEvaluation | null>(null)
  const [evalError, setEvalError] = useState('')
  const [sectionIndex, setSectionIndex] = useState(0)

  // ── Adaptive checkpoints ────────────────────────────────────────────────────
  const [answered, setAnswered] = useState<AnsweredCheckpoint[]>([])
  const [askedIndexes, setAskedIndexes] = useState<number[]>([])
  const [activeIndex, setActiveIndex] = useState(-1)
  const [targetDifficulty, setTargetDifficulty] = useState<QuestionDifficulty>('core')
  /** Concepts the student got wrong — carried into the next lesson's prompt. */
  const [weakConcepts, setWeakConcepts] = useState<string[]>([])

  const requestRef = useRef(0)
  /** Wall-clock start, so completed lessons report real study minutes. */
  const startedAtRef = useRef(Date.now())
  const completionSavedRef = useRef(false)

  // Mirrored into refs so saveProgress can read current values without being
  // recreated on every state change.
  const lessonRef = useRef<AILesson | null>(null)
  const phaseRef = useRef<LessonPhase>('teaching')
  const pausedRef = useRef(false)

  useEffect(() => {
    lessonRef.current = lesson
  }, [lesson])
  useEffect(() => {
    phaseRef.current = phase
  }, [phase])
  useEffect(() => {
    pausedRef.current = paused
  }, [paused])

  /**
   * Records progress against the learner's Supabase row.
   *
   * Fire-and-forget: a failed write must never interrupt a lesson, so errors
   * are logged rather than surfaced. The lesson title is sent because generated
   * lessons have no predictable key — the route creates a `lessons` row for it.
   */
  const saveProgress = useCallback(
    (status: 'in_progress' | 'completed', percentage: number, extra?: Record<string, unknown>) => {
      const current = lessonRef.current
      if (!current) return

      void fetch('/api/progress/lesson', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lessonKey: current.id,
          lessonTitle: current.title,
          status,
          progressPercentage: Math.round(percentage),
          timeSpentSeconds: Math.round((Date.now() - startedAtRef.current) / 1000),
          currentSection: phaseRef.current,
          paused: pausedRef.current,
          progressState: extra ?? {},
        }),
      }).catch((err) => console.warn('[classroom] Could not save progress:', err))
    },
    [],
  )

  // ── Lesson generation ───────────────────────────────────────────────────────
  const loadLesson = useCallback(
    async (
      topic: string,
      preferences: LearnerPreferences,
      index: number,
      covered: string[],
      materialIds: string[] = [],
      struggledWith: string[] = [],
    ) => {
      const requestId = ++requestRef.current
      setLoadState('loading')
      setLoadError('')
      setEvaluation(null)
      setEvalError('')
      setSelected(null)
      setShortAnswer('')
      setSectionIndex(0)
      setPhase('teaching')

      // A new lesson starts a fresh set of checkpoints, but weak concepts
      // deliberately persist — they are what the next lesson adapts to.
      setAnswered([])
      setAskedIndexes([])
      setActiveIndex(-1)
      setTargetDifficulty('core')

      try {
        const res = await fetch('/api/teacher/generate-lesson', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            topic,
            materialIds,
            preferences,
            lessonIndex: index,
            previousTopics: covered,
            weakConcepts: struggledWith,
          }),
        })

        const data = await res.json()
        if (requestId !== requestRef.current) return

        if (!res.ok) {
          setLoadError(data?.error ?? `Lesson generation failed (HTTP ${res.status}).`)
          setLoadState('error')
          return
        }

        setLesson(data.lesson as AILesson)
        lessonRef.current = data.lesson as AILesson
        startedAtRef.current = Date.now()
        completionSavedRef.current = false
        setResponseMode(data.lesson?.question?.type === 'Freeform' ? 'freeform' : 'mcq')
          setLoadState('ready')
        // Register the lesson as started so it shows on the dashboard even if
        // the learner leaves before finishing.
        saveProgress('in_progress', 5)
        setPlaying(true)
        setPaused(false)
      } catch (err) {
        if (requestId !== requestRef.current) return
        setLoadError(err instanceof Error ? err.message : 'Could not reach the AI teacher.')
        setLoadState('error')
      }
    },
    [saveProgress],
  )

  // See lesson-plan: Strict Mode double-invokes effects, and each duplicate
  // generation costs one request from a per-model daily quota.
  const didInit = useRef(false)

  useEffect(() => {
    if (didInit.current) return
    didInit.current = true

    const s = readSession()
    setSession(s)

    // /lesson-plan already generated this lesson — reuse it rather than paying
    // the ~30s generation cost a second time.
    try {
      const cached = sessionStorage.getItem(LESSON_CACHE_KEY)
      if (cached) {
        const parsed = JSON.parse(cached) as { signature?: string; lesson?: AILesson }
        if (parsed.signature === sessionSignature(s) && parsed.lesson?.sections?.length) {
          setLesson(parsed.lesson)
          setResponseMode(parsed.lesson.question?.type === 'Freeform' ? 'freeform' : 'mcq')
          setLoadState('ready')
          return
        }
      }
    } catch {
      // fall through to generating
    }

    void loadLesson(s.topic, s.preferences, 0, [], s.materialIds ?? [])
  }, [loadLesson])

  // ── Derived ─────────────────────────────────────────────────────────────────
  const sections = lesson?.sections ?? []
  const totalSteps = Math.max(sections.length, 1)
  const progressPct = Math.round(((sectionIndex + 1) / totalSteps) * 100)

  const teachingParagraphs = useMemo(
    () => toParagraphs(lesson?.teachingPrompt),
    [lesson?.teachingPrompt],
  )

  /** Every checkpoint available, newest contract first, single-question fallback. */
  const questionPool: AIQuestion[] = useMemo(() => {
    if (!lesson) return []
    if (lesson.questions?.length) return lesson.questions
    return [lesson.question]
  }, [lesson])

  const currentQuestion: AIQuestion | null =
    activeIndex >= 0 ? (questionPool[activeIndex] ?? null) : null

  const lessonVisual = useMemo(() => stripFence(lesson?.visualPayload), [lesson?.visualPayload])
  const questionVisual = useMemo(
    () => stripFence(currentQuestion?.visualPayload),
    [currentQuestion?.visualPayload],
  )
  const evalVisual = useMemo(() => stripFence(evaluation?.visualPayload), [evaluation?.visualPayload])

  const remainingCount = questionPool.length - askedIndexes.length
  const correctCount = answered.filter((a) => a.correct).length

  const isMcq =
    currentQuestion?.type !== 'Freeform' && !!currentQuestion?.options?.length

  /**
   * Chooses the next checkpoint: the closest unasked question to the target
   * difficulty. Returns -1 when the student has answered everything.
   */
  const pickQuestion = useCallback(
    (target: QuestionDifficulty): number => {
      const unasked = questionPool
        .map((q, i) => ({ q, i }))
        .filter(({ i }) => !askedIndexes.includes(i))

      if (unasked.length === 0) return -1

      const targetRank = DIFFICULTY_ORDER.indexOf(target)
      unasked.sort((a, b) => {
        const ra = DIFFICULTY_ORDER.indexOf(a.q.difficulty ?? 'core')
        const rb = DIFFICULTY_ORDER.indexOf(b.q.difficulty ?? 'core')
        return Math.abs(ra - targetRank) - Math.abs(rb - targetRank)
      })

      return unasked[0]!.i
    },
    [questionPool, askedIndexes],
  )

  const statusLabel: Record<LessonPhase, string> = {
    teaching: 'Teaching',
    question: 'AI asking a question',
    answering: 'Student answering',
    evaluating: 'AI evaluating',
    reexplaining: 'AI re-explaining',
    continuing: 'Continuing lesson',
  }

  // ── Narration ───────────────────────────────────────────────────────────────
  const speech = useSpeech(session.preferences.language)

  /** The full text Maya speaks for the current phase. */
  const narration = useMemo(() => {
    if (!lesson) return ''
    switch (phase) {
      case 'teaching':
        return `${lesson.summary} ${lesson.teachingPrompt}`
      case 'question':
        return currentQuestion
          ? `${currentQuestion.teacherPrompt} ${currentQuestion.prompt}`
          : ''
      case 'reexplaining':
        return evaluation
          ? `${evaluation.feedback} ${evaluation.reexplanation}`
          : lesson.reexplanation
      case 'continuing':
        return `${evaluation?.feedback ?? ''} ${lesson.completionMessage}`.trim()
      default:
        return ''
    }
  }, [lesson, phase, evaluation])

  // Speak whenever the phase changes to one that has narration. Silent phases
  // (answering, evaluating) stop playback rather than talking over the student.
  // Pause/resume is handled by the transport controls so a paused lesson
  // continues mid-sentence instead of restarting the paragraph.
  useEffect(() => {
    if (!narration) {
      speech.stop()
      return
    }
    speech.speak(narration)
    // `speech` is recreated each render; `narration` is the real trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [narration])

  const avatarLine =
    loadState === 'loading'
      ? 'Planning your lesson…'
      : phase === 'teaching'
        ? lesson?.teachingPrompt?.slice(0, 160) ?? ''
        : phase === 'question'
          ? lesson?.question?.teacherPrompt ?? ''
          : phase === 'answering'
            ? 'Take your time. I will read your answer carefully.'
            : phase === 'evaluating'
              ? 'Let me look at your reasoning.'
              : phase === 'reexplaining'
                ? evaluation?.feedback ?? ''
                : evaluation?.feedback ?? lesson?.completionMessage ?? ''

  // ── Actions ─────────────────────────────────────────────────────────────────
  function openAskTeacher() {
    setResumePhase(phase)
    setShowAskPanel(true)
  }

  function closeAskTeacher() {
    setShowAskPanel(false)
    setAskDraft('')
    setAskError('')
    setPhase(resumePhase)
  }

  /**
   * Sends a student question scoped to the current lesson. History is passed
   * through so follow-ups like "why?" resolve against the previous answer
   * rather than being read as a fresh question.
   */
  async function sendAskTeacher(message?: string) {
    if (!lesson) return
    const text = (message ?? askDraft).trim()
    if (!text || askSending) return

    const history = [...askThread]
    setAskThread([...history, { role: 'user', content: text }])
    setAskDraft('')
    setFollowUps([])
    setAskError('')
    setAskSending(true)

    try {
      const res = await fetch('/api/teacher/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lessonTitle: lesson.title,
          lessonObjective: lesson.objective,
          lessonKeyPoints: lesson.keyPoints,
          conversationHistory: history,
          userMessage: text,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        setAskError(data?.error ?? `Maya could not answer (HTTP ${res.status}).`)
        return
      }

      const answer = String(data.answer ?? '')
      setAskThread((prev) => [...prev, { role: 'assistant', content: answer }])
      setFollowUps(Array.isArray(data.followUpSuggestions) ? data.followUpSuggestions : [])

      // She is a speaking teacher — answers should be spoken too.
      speech.speak(answer)
    } catch (err) {
      setAskError(err instanceof Error ? err.message : 'Could not reach the AI teacher.')
    } finally {
      setAskSending(false)
    }
  }

  function beginQuestion() {
    const index = pickQuestion(targetDifficulty)
    if (index < 0) {
      // Nothing left to ask — go straight to the wrap-up.
      setPhase('continuing')
      return
    }

    setActiveIndex(index)
    setAskedIndexes((prev) => [...prev, index])
    setResponseMode(questionPool[index]?.type === 'Freeform' ? 'freeform' : 'mcq')
    setResumePhase(phase === 'question' ? 'teaching' : phase)
    setPhase('question')
    setSelected(null)
    setShortAnswer('')
    setEvaluation(null)
    setEvalError('')
  }

  async function submitAnswer() {
    if (!lesson || !currentQuestion) return
    if (isMcq && selected === null) return
    if (!isMcq && shortAnswer.trim().length === 0) return

    setPhase('evaluating')
    setEvalError('')

    const payload: Record<string, unknown> = {
      lessonTitle: lesson.title,
      lessonObjective: lesson.objective,
      lessonKeyPoints: lesson.keyPoints,
      lessonTeachingPrompt: lesson.teachingPrompt,
      questionPrompt: currentQuestion.prompt,
    }

    if (isMcq) {
      payload.questionOptions = currentQuestion.options
      payload.correctIndex = currentQuestion.correctIndex
      payload.selectedIndex = selected
      if (shortAnswer.trim()) payload.studentFreeformText = shortAnswer.trim()
    } else {
      payload.expectedAnswer = currentQuestion.expectedAnswer
      payload.studentFreeformText = shortAnswer.trim()
    }

    try {
      const res = await fetch('/api/teacher/evaluate-answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const data = await res.json()

      if (!res.ok) {
        setEvalError(data?.error ?? `Evaluation failed (HTTP ${res.status}).`)
        setPhase('question')
        return
      }

      const result = data.evaluation as AIEvaluation
      setEvaluation(result)

      // Record the outcome, move the difficulty target, and remember the
      // concept if it was missed — this is what makes the next question, and
      // the next lesson, respond to how the student is actually doing.
      const difficulty = currentQuestion.difficulty ?? 'core'
      setAnswered((prev) => [
        ...prev,
        { difficulty, concept: currentQuestion.concept, correct: result.isCorrect },
      ])
      setTargetDifficulty(nextDifficulty(difficulty, result.isCorrect))

      if (!result.isCorrect) {
        const missed = currentQuestion.concept ?? result.misunderstandingDetected
        if (missed) {
          setWeakConcepts((prev) => (prev.includes(missed) ? prev : [...prev, missed]))
        }
      }

      setPhase(result.isCorrect ? 'continuing' : 'reexplaining')

      // Persist after each checkpoint so a dropped session keeps its progress.
      const answeredNow = answered.length + 1
      const pct = Math.min(
        99,
        Math.round(
          ((sectionIndex + 1) / totalSteps) * 50 +
            (questionPool.length > 0 ? (answeredNow / questionPool.length) * 50 : 0),
        ),
      )
      if (answeredNow >= questionPool.length) {
        completeLesson()
      } else {
        saveProgress('in_progress', pct)
      }
    } catch (err) {
      setEvalError(err instanceof Error ? err.message : 'Could not reach the AI teacher.')
      setPhase('question')
    }
  }

  function advanceSection() {
    setSectionIndex((i) => Math.min(i + 1, totalSteps - 1))
    setPhase('teaching')
    saveProgress('in_progress', overallProgress())
  }

  function nextLesson() {
    if (!lesson) return
    // Moving on finishes the lesson behind you.
    if (answered.length > 0) completeLesson()
    // The cached plan describes the lesson we are leaving — drop it.
    try {
      sessionStorage.removeItem(LESSON_CACHE_KEY)
    } catch {
      // ignore
    }
    const nextTopic = lesson.nextTopicSuggestion?.trim() || session.topic
    const covered = [...previousTopics, lesson.title]
    setPreviousTopics(covered)
    setLessonIndex((i) => i + 1)
    void loadLesson(
      nextTopic,
      session.preferences,
      lessonIndex + 1,
      covered,
      session.materialIds ?? [],
      weakConcepts,
    )
  }

  function retryQuestion() {
    setSelected(null)
    setShortAnswer('')
    setEvaluation(null)
    setPhase('question')
  }

  function resumeLesson() {
    setPaused(false)
    setPlaying(true)
    setPhase('teaching')
  }

  /** Teaching progress and checkpoint progress, weighted into one figure. */
  function overallProgress(): number {
    const sectionShare = ((sectionIndex + 1) / totalSteps) * 50
    const checkpointShare =
      questionPool.length > 0 ? (answered.length / questionPool.length) * 50 : 0
    return Math.min(99, Math.round(sectionShare + checkpointShare))
  }

  function completeLesson() {
    if (completionSavedRef.current) return
    completionSavedRef.current = true
    saveProgress('completed', 100, {
      correct: correctCount,
      answered: answered.length,
      weakConcepts,
    })
  }

  function endLesson() {
    setPlaying(false)
    setPaused(true)
    // Only a lesson the learner actually worked through counts as completed.
    if (answered.length > 0) completeLesson()
    router.push('/progress/report')
  }

  // ── Loading / error gates ───────────────────────────────────────────────────
  if (loadState === 'loading') {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-5 rounded-[28px] border border-white/10 bg-[#081522] p-10 text-center">
        <div className="relative flex size-20 items-center justify-center rounded-full border border-cyan-300/35 bg-gradient-to-br from-cyan-400/20 to-slate-900/80">
          <div className="absolute inset-0 animate-ping rounded-full border border-cyan-400/40" />
          <Bot className="size-8 text-cyan-300" />
        </div>
        <div>
          <p className="text-lg font-semibold text-white">Maya is planning your lesson</p>
          <p className="mt-1.5 max-w-md text-sm text-slate-400">
            Building a {session.preferences.timeMinutes}-minute {session.preferences.level.toLowerCase()} lesson
            on “{session.topic}” in {session.preferences.language}.
          </p>
        </div>
        <Loader2 className="size-5 animate-spin text-cyan-300" />
      </div>
    )
  }

  if (loadState === 'error' || !lesson) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-5 rounded-[28px] border border-red-500/20 bg-[#150c0c] p-10 text-center">
        <div className="flex size-14 items-center justify-center rounded-full border border-red-500/30 bg-red-500/10">
          <AlertTriangle className="size-6 text-red-300" />
        </div>
        <div>
          <p className="text-lg font-semibold text-white">The lesson could not be generated</p>
          <p className="mx-auto mt-2 max-w-lg break-words text-sm text-red-200/80">{loadError}</p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button
            className="bg-gradient-to-r from-cyan-500 to-blue-500 text-white"
            onClick={() => void loadLesson(session.topic, session.preferences, lessonIndex, previousTopics, session.materialIds ?? [])}
          >
            <RefreshCw className="mr-2 size-4" />
            Try again
          </Button>
          <Button
            variant="secondary"
            className="border border-white/10 bg-white/5 text-slate-200"
            onClick={() => router.push('/start')}
          >
            Change topic
          </Button>
        </div>
      </div>
    )
  }

  // ── Lesson UI ───────────────────────────────────────────────────────────────
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="flex flex-col gap-6">
        <div className="relative overflow-hidden rounded-[28px] border border-white/10 bg-[#081522] shadow-[0_30px_100px_rgba(14,165,233,0.28)]">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.28),_transparent_40%),linear-gradient(135deg,#081522_0%,#0b172a_45%,#081522_100%)]" />
          <div className="absolute inset-0 opacity-30">
            <div className="absolute left-1/2 top-1/3 h-72 w-72 -translate-x-1/2 rounded-full bg-cyan-400/20 blur-[120px]" />
            <div className="absolute bottom-0 left-1/2 h-64 w-64 -translate-x-1/2 rounded-full bg-blue-500/20 blur-[100px]" />
          </div>

          <div className="relative z-10 p-4 sm:p-6">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Badge className="gap-1.5 bg-primary/15 text-primary">Live lesson</Badge>
                  <span className="text-xs uppercase tracking-[0.2em] text-slate-400">{lesson.subtitle}</span>
                  <Badge className="bg-white/5 text-slate-300">{session.preferences.language}</Badge>
                  <Badge className="bg-white/5 text-slate-300">{session.preferences.level}</Badge>
                </div>
                <h1 className="text-xl font-semibold text-white sm:text-2xl">{lesson.title}</h1>
                <p className="mt-1 text-sm text-slate-400">{lesson.objective}</p>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-9 rounded-full border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10"
                  onClick={openAskTeacher}
                >
                  <Bot className="mr-2 size-3.5" />
                  Ask AI Teacher
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-9 w-9 rounded-full border border-white/10 bg-white/5 p-0 text-slate-200 hover:bg-white/10"
                  aria-label="Toggle captions"
                  onClick={() => setShowTranscript((v) => !v)}
                >
                  <Captions className="size-4" />
                </Button>
              </div>
            </div>

            <div className="mb-4 flex items-center justify-between rounded-2xl border border-white/10 bg-slate-900/30 px-3 py-2 text-xs text-slate-300 backdrop-blur-sm">
              <div className="flex items-center gap-2">
                <Radio className={cn('size-3.5', playing ? 'text-green-400' : 'text-slate-500')} />
                <span>{statusLabel[phase]}</span>
              </div>
              <div className="flex items-center gap-2">
                <span>Section {Math.min(sectionIndex + 1, totalSteps)}</span>
                <span className="text-slate-500">/</span>
                <span>{totalSteps}</span>
              </div>
            </div>

            {/* Teacher stage */}
            <div className="relative aspect-video overflow-hidden rounded-[24px] border border-white/10 bg-slate-950/40">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_rgba(56,189,248,0.18),_transparent_50%)]" />

              <div className="absolute left-4 top-4 z-10 flex items-center gap-2 rounded-full border border-white/10 bg-slate-900/60 px-3 py-1.5 text-xs text-slate-200 backdrop-blur-sm">
                <span className="relative flex size-2 rounded-full bg-green-400" />
                Live AI teacher
              </div>

              <div className="absolute right-4 top-4 z-10 flex items-center gap-2">
                <Button
                  size="icon"
                  variant="secondary"
                  className="h-9 w-9 rounded-full border border-white/10 bg-slate-900/60 text-slate-200 hover:bg-slate-800"
                  aria-label={speech.speaking ? 'Mute narration' : 'Replay narration'}
                  onClick={() => (speech.speaking ? speech.stop() : speech.speak(narration))}
                >
                  {speech.speaking ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
                </Button>
              </div>

              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center">
                <TeacherAvatar
                  viseme={speech.viseme}
                  speaking={speech.speaking}
                  paused={paused || speech.paused}
                  status={statusLabel[phase]}
                />

                <p className="line-clamp-2 max-w-2xl text-sm leading-relaxed text-slate-300">
                  {avatarLine}
                </p>

                {!speech.supported && (
                  <p className="rounded-full border border-amber-400/25 bg-amber-500/10 px-3 py-1 text-xs text-amber-200">
                    This browser has no speech synthesis — the lesson is text-only.
                  </p>
                )}
                {speech.supported && speech.languageUnavailable && (
                  <p className="rounded-full border border-amber-400/25 bg-amber-500/10 px-3 py-1 text-xs text-amber-200">
                    No {session.preferences.language} voice installed on this device — narration
                    will use the default voice.
                  </p>
                )}
              </div>

              <div className="absolute inset-x-0 bottom-0 z-10 flex items-center gap-3 bg-gradient-to-t from-slate-950/85 via-slate-950/40 to-transparent px-4 pb-4 pt-10">
                <Button
                  size="icon"
                  className="h-11 w-11 rounded-full bg-gradient-to-r from-cyan-500 to-blue-500 text-white shadow-lg shadow-cyan-500/20"
                  aria-label={paused ? 'Resume lesson' : 'Pause lesson'}
                  onClick={() => {
                    if (paused) {
                      resumeLesson()
                      speech.resume()
                    } else {
                      setPaused(true)
                      setPlaying(false)
                      speech.pause()
                    }
                  }}
                >
                  {paused ? <Play className="ml-0.5 size-4" /> : <Pause className="size-4" />}
                </Button>

                <Button
                  variant="secondary"
                  className="h-11 rounded-full border border-white/10 bg-white/5 text-slate-100 hover:bg-white/10"
                  onClick={endLesson}
                >
                  End lesson
                </Button>

                <div className="ml-auto flex items-center gap-2">
                  <div className="w-28 overflow-hidden rounded-full bg-slate-700/70">
                    <div
                      className="h-1.5 rounded-full bg-gradient-to-r from-cyan-400 to-blue-500"
                      style={{ width: `${Math.min(100, progressPct)}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.9fr)]">
              <div className="rounded-[24px] border border-white/10 bg-slate-900/40 p-4 sm:p-5">
                {/* ── Teaching ─────────────────────────────────────────────── */}
                {phase === 'teaching' && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-400">Teaching</p>
                      <Badge className="bg-cyan-500/15 text-cyan-200">
                        {sections[sectionIndex]?.type ?? 'Concept'}
                      </Badge>
                    </div>

                    <p className="text-lg font-medium text-white">
                      {sections[sectionIndex]?.title ?? lesson.title}
                    </p>

                    <p className="leading-relaxed text-slate-300">{lesson.summary}</p>

                    <div className="space-y-3 border-l-2 border-cyan-400/20 pl-4">
                      {teachingParagraphs.map((para, i) => (
                        <p key={i} className="leading-relaxed text-slate-300">
                          {para}
                        </p>
                      ))}
                    </div>

                    {lessonVisual && (
                      <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-950/60">
                        {lessonVisual.language && (
                          <div className="border-b border-white/10 px-3 py-1.5 text-[10px] uppercase tracking-[0.18em] text-slate-500">
                            {lessonVisual.language}
                          </div>
                        )}
                        <pre className="overflow-x-auto p-4 text-xs leading-relaxed text-cyan-100">
                          {lessonVisual.body}
                        </pre>
                      </div>
                    )}

                    <div className="grid gap-3 sm:grid-cols-3">
                      {lesson.keyPoints.map((point) => (
                        <div
                          key={point}
                          className="rounded-2xl border border-cyan-400/10 bg-cyan-500/5 p-3 text-sm text-slate-200"
                        >
                          {point}
                        </div>
                      ))}
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                      <Button
                        className="bg-gradient-to-r from-cyan-500 to-blue-500 text-white"
                        onClick={beginQuestion}
                      >
                        Continue to question
                        <ChevronRight className="ml-2 size-4" />
                      </Button>
                      {sectionIndex < totalSteps - 1 && (
                        <Button
                          variant="secondary"
                          className="border border-white/10 bg-white/5 text-slate-200"
                          onClick={advanceSection}
                        >
                          Next section
                        </Button>
                      )}
                    </div>
                  </div>
                )}

                {/* ── Question ─────────────────────────────────────────────── */}
                {phase === 'question' && currentQuestion && (
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-400">
                        Checkpoint {askedIndexes.length} of {questionPool.length}
                      </p>
                      <div className="flex items-center gap-2">
                        {answered.length > 0 && (
                          <span className="text-xs text-slate-400">
                            {correctCount}/{answered.length} correct
                          </span>
                        )}
                        <Badge
                          className={cn(
                            (currentQuestion.difficulty ?? 'core') === 'easy' &&
                              'bg-emerald-500/15 text-emerald-200',
                            (currentQuestion.difficulty ?? 'core') === 'core' &&
                              'bg-violet-500/15 text-violet-200',
                            (currentQuestion.difficulty ?? 'core') === 'stretch' &&
                              'bg-amber-500/15 text-amber-200',
                          )}
                        >
                          {DIFFICULTY_LABEL[currentQuestion.difficulty ?? 'core']}
                        </Badge>
                      </div>
                    </div>

                    {answered.length > 0 && (
                      <p className="text-xs text-cyan-300/80">
                        {answered[answered.length - 1]!.correct
                          ? 'You got the last one — this one goes a step further.'
                          : 'Stepping back to something more basic first.'}
                      </p>
                    )}

                    <p className="text-sm italic text-slate-400">{currentQuestion.teacherPrompt}</p>
                    <p className="text-lg font-medium text-white">{currentQuestion.prompt}</p>

                    {questionVisual && (
                      <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-950/60">
                        <pre className="overflow-x-auto p-4 text-xs leading-relaxed text-cyan-100">
                          {questionVisual.body}
                        </pre>
                      </div>
                    )}

                    {isMcq && (
                      <div className="flex flex-wrap gap-2">
                        {(['mcq', 'freeform'] as ResponseMode[]).map((mode) => (
                          <button
                            key={mode}
                            type="button"
                            onClick={() => setResponseMode(mode)}
                            className={cn(
                              'rounded-full border px-3 py-1.5 text-xs transition-colors',
                              responseMode === mode
                                ? 'border-cyan-400/50 bg-cyan-500/10 text-cyan-100'
                                : 'border-white/10 bg-white/5 text-slate-300',
                            )}
                          >
                            {mode === 'mcq' ? 'Multiple choice' : 'Answer in your own words'}
                          </button>
                        ))}
                      </div>
                    )}

                    {isMcq && responseMode === 'mcq' ? (
                      <div className="grid gap-2.5">
                        {currentQuestion.options?.map((option, index) => (
                          <button
                            key={option}
                            type="button"
                            onClick={() => setSelected(index)}
                            className={cn(
                              'flex items-center gap-3 rounded-2xl border px-4 py-3 text-left text-sm transition-colors',
                              selected === index
                                ? 'border-cyan-400/50 bg-cyan-500/10 text-white'
                                : 'border-white/10 bg-slate-950/30 text-slate-200 hover:border-cyan-400/30',
                            )}
                          >
                            <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-xs text-slate-300">
                              {String.fromCharCode(65 + index)}
                            </span>
                            {option}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <textarea
                        value={shortAnswer}
                        onChange={(e) => setShortAnswer(e.target.value)}
                        placeholder="Answer in your own words..."
                        className="min-h-28 w-full rounded-2xl border border-white/10 bg-slate-950/30 p-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-400/50"
                      />
                    )}

                    {evalError && (
                      <p className="rounded-2xl border border-red-500/20 bg-red-500/5 px-3 py-2 text-sm text-red-200">
                        {evalError}
                      </p>
                    )}

                    <div className="flex items-center justify-between gap-3">
                      <Button
                        variant="secondary"
                        className="border border-white/10 bg-white/5 text-slate-200"
                        onClick={() => setPhase('teaching')}
                      >
                        Back to teaching
                      </Button>
                      <Button
                        className="bg-gradient-to-r from-cyan-500 to-blue-500 text-white disabled:opacity-40"
                        disabled={isMcq && responseMode === 'mcq' ? selected === null : shortAnswer.trim().length === 0}
                        onClick={() => void submitAnswer()}
                      >
                        Submit answer
                      </Button>
                    </div>
                  </div>
                )}

                {/* ── Evaluating ───────────────────────────────────────────── */}
                {phase === 'evaluating' && (
                  <div className="space-y-4">
                    <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-400">AI evaluating</p>
                    <div className="flex items-center gap-3 rounded-2xl border border-violet-400/20 bg-violet-500/10 px-4 py-5 text-violet-50">
                      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-violet-500/20">
                        <Sparkles className="size-4 animate-pulse" />
                      </div>
                      Checking your reasoning against the lesson objective…
                    </div>
                  </div>
                )}

                {/* ── Re-explaining ────────────────────────────────────────── */}
                {phase === 'reexplaining' && evaluation && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-400">AI re-explaining</p>
                      <Badge className="bg-amber-500/15 text-amber-200">Reinforce concept</Badge>
                    </div>

                    <p className="text-lg font-medium text-white">{evaluation.feedback}</p>

                    {evaluation.misunderstandingDetected && (
                      <div className="flex gap-3 rounded-2xl border border-amber-400/25 bg-amber-500/5 p-3">
                        <Lightbulb className="mt-0.5 size-4 shrink-0 text-amber-300" />
                        <div>
                          <p className="text-[10px] uppercase tracking-[0.18em] text-amber-300/80">
                            Misconception detected
                          </p>
                          <p className="mt-1 text-sm text-amber-100">{evaluation.misunderstandingDetected}</p>
                        </div>
                      </div>
                    )}

                    <div className="rounded-2xl border border-white/10 bg-slate-950/30 p-3">
                      <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Correct answer</p>
                      <p className="mt-1 text-sm text-slate-200">{evaluation.correctAnswer}</p>
                    </div>

                    <p className="leading-relaxed text-slate-300">{evaluation.reexplanation}</p>

                    {evalVisual && (
                      <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-950/60">
                        <pre className="overflow-x-auto p-4 text-xs leading-relaxed text-cyan-100">
                          {evalVisual.body}
                        </pre>
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-3">
                      <Button
                        className="bg-gradient-to-r from-cyan-500 to-blue-500 text-white"
                        onClick={retryQuestion}
                      >
                        Try the question again
                      </Button>
                      {remainingCount > 0 ? (
                        <Button
                          variant="secondary"
                          className="border border-white/10 bg-white/5 text-slate-200"
                          onClick={beginQuestion}
                        >
                          Try an easier one
                        </Button>
                      ) : (
                        <Button
                          variant="secondary"
                          className="border border-white/10 bg-white/5 text-slate-200"
                          onClick={() => setPhase('continuing')}
                        >
                          Continue anyway
                        </Button>
                      )}
                    </div>
                  </div>
                )}

                {/* ── Continuing ───────────────────────────────────────────── */}
                {phase === 'continuing' && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-400">Continuing lesson</p>
                      <Badge className="bg-emerald-500/15 text-emerald-200">
                        {evaluation?.isCorrect ? 'Correct' : 'Keep going'}
                      </Badge>
                    </div>

                    <p className="text-lg font-medium text-white">
                      {evaluation?.feedback ?? lesson.completionMessage}
                    </p>

                    {evaluation?.reexplanation && (
                      <p className="leading-relaxed text-slate-300">{evaluation.reexplanation}</p>
                    )}

                    <p className="leading-relaxed text-slate-400">{lesson.completionMessage}</p>

                    {lesson.nextTopicSuggestion && (
                      <div className="rounded-2xl border border-cyan-400/20 bg-cyan-500/5 p-3">
                        <p className="text-[10px] uppercase tracking-[0.18em] text-cyan-300/80">Up next</p>
                        <p className="mt-1 text-sm text-slate-200">{lesson.nextTopicSuggestion}</p>
                      </div>
                    )}

                    {answered.length > 0 && (
                      <div className="rounded-2xl border border-white/10 bg-slate-950/30 p-3">
                        <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">
                          Checkpoints
                        </p>
                        <p className="mt-1 text-sm text-slate-200">
                          {correctCount} of {answered.length} correct
                        </p>
                        {weakConcepts.length > 0 && (
                          <p className="mt-1.5 text-xs text-amber-200/90">
                            Needs review: {weakConcepts.join(', ')}
                          </p>
                        )}
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-3">
                      {remainingCount > 0 && (
                        <Button
                          className="bg-gradient-to-r from-cyan-500 to-blue-500 text-white"
                          onClick={beginQuestion}
                        >
                          Next checkpoint
                          <ChevronRight className="ml-2 size-4" />
                        </Button>
                      )}
                      <Button
                        variant={remainingCount > 0 ? 'secondary' : undefined}
                        className={
                          remainingCount > 0
                            ? 'border border-white/10 bg-white/5 text-slate-200'
                            : 'bg-gradient-to-r from-cyan-500 to-blue-500 text-white'
                        }
                        onClick={nextLesson}
                      >
                        Next lesson
                        <ChevronRight className="ml-2 size-4" />
                      </Button>
                      <Button
                        variant="secondary"
                        className="border border-white/10 bg-white/5 text-slate-200"
                        onClick={resumeLesson}
                      >
                        Review this lesson
                      </Button>
                      <Button
                        variant="secondary"
                        className="border border-white/10 bg-white/5 text-slate-200"
                        onClick={endLesson}
                      >
                        Finish & see report
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              {/* ── Lesson plan sidebar ────────────────────────────────────── */}
              <div className="rounded-[24px] border border-white/10 bg-slate-900/40 p-4 sm:p-5">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Lesson progress</p>
                    <p className="mt-1 text-lg font-semibold text-white">{progressPct}% complete</p>
                  </div>
                  <div className="rounded-full border border-cyan-400/20 bg-cyan-500/10 px-2 py-1 text-xs text-cyan-200">
                    {Math.min(sectionIndex + 1, totalSteps)}/{totalSteps}
                  </div>
                </div>
                <Progress value={progressPct} className="h-2 bg-slate-800" />

                <div className="mt-5 space-y-2">
                  {sections.map((step, i) => {
                    const active = i === sectionIndex
                    const done = i < sectionIndex

                    return (
                      <button
                        key={`${step.title}-${i}`}
                        type="button"
                        onClick={() => {
                          setSectionIndex(i)
                          setPhase('teaching')
                        }}
                        className={cn(
                          'flex w-full items-start gap-3 rounded-2xl border px-3 py-3 text-left transition-colors',
                          active
                            ? 'border-cyan-400/30 bg-cyan-500/5'
                            : 'border-white/10 bg-slate-950/20 hover:border-cyan-400/20',
                        )}
                      >
                        <div className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-[10px] text-slate-300">
                          {done ? <Check className="size-3 text-emerald-400" /> : i + 1}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <p className={cn('text-sm font-medium', active ? 'text-white' : 'text-slate-300')}>
                              {step.title}
                            </p>
                            <span className="shrink-0 text-[10px] uppercase tracking-[0.2em] text-slate-400">
                              {step.type}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-slate-400">{step.minutes} min</p>
                          {active && step.description && (
                            <p className="mt-1.5 text-xs leading-relaxed text-slate-500">{step.description}</p>
                          )}
                        </div>
                      </button>
                    )
                  })}
                </div>

                <div className="mt-5 rounded-2xl border border-white/10 bg-slate-950/30 p-3 text-sm text-slate-300">
                  <div className="flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-slate-400">
                    <Circle className="size-2.5 fill-emerald-400 text-emerald-400" />
                    Captions
                  </div>
                  {showTranscript ? (
                    <ul className="mt-3 space-y-3 text-sm text-slate-200">
                      {teachingParagraphs.map((text, i) => (
                        <li key={i} className="flex gap-3">
                          <span className="shrink-0 text-[10px] uppercase tracking-[0.16em] text-slate-500">
                            {String(i + 1).padStart(2, '0')}
                          </span>
                          <span>{text}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-3 text-slate-400">Captions are hidden. Toggle to review the live transcript.</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Right rail ───────────────────────────────────────────────────────── */}
      <aside className="relative xl:pt-6">
        <div className="rounded-[24px] border border-white/10 bg-slate-900/50 p-4 shadow-[0_20px_50px_rgba(15,23,42,0.45)] backdrop-blur-sm">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Current lesson</p>
              <p className="mt-1 truncate text-base font-semibold text-white">{lesson.title}</p>
            </div>
            <Button
              variant="secondary"
              className="h-9 shrink-0 rounded-full border border-white/10 bg-white/5 text-slate-200"
              onClick={openAskTeacher}
            >
              Ask
            </Button>
          </div>

          <div className="mb-4 rounded-2xl border border-white/10 bg-slate-950/30 p-3 text-sm text-slate-300">
            <div className="mb-2 flex items-center justify-between text-xs uppercase tracking-[0.16em] text-slate-400">
              <span>Session</span>
              <span>{progressPct}%</span>
            </div>
            <Progress value={progressPct} className="h-2 bg-slate-800" />
            <p className="mt-2 text-xs text-slate-500">
              Lesson {lessonIndex + 1} · {session.preferences.timeMinutes} min · {session.preferences.language}
            </p>
          </div>

          <div className="mb-4 rounded-2xl border border-white/10 bg-slate-950/30 p-3">
            <p className="mb-2 text-xs uppercase tracking-[0.16em] text-slate-400">
              Teaching video
            </p>
            <LessonVideoButton
              lesson={lesson}
              language={session.preferences.language}
              voice={speech.voice}
              onBeforeRecord={speech.stop}
            />
          </div>

          <div className="mb-4 space-y-2 text-sm text-slate-300">
            <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-slate-950/30 px-3 py-2.5">
              <span>Pause Teacher</span>
              <Button
                size="icon"
                variant="secondary"
                className="h-8 w-8 rounded-full border border-white/10 bg-white/5 p-0 text-slate-200"
                aria-label="Pause teacher"
                onClick={() => {
                  setPaused(true)
                  setPlaying(false)
                }}
              >
                <Pause className="size-3.5" />
              </Button>
            </div>
            <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-slate-950/30 px-3 py-2.5">
              <span>Resume</span>
              <Button
                size="icon"
                variant="secondary"
                className="h-8 w-8 rounded-full border border-white/10 bg-white/5 p-0 text-slate-200"
                aria-label="Resume lesson"
                onClick={resumeLesson}
              >
                <Play className="ml-0.5 size-3.5" />
              </Button>
            </div>
            <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-slate-950/30 px-3 py-2.5">
              <span>Repeat Explanation</span>
              <Button
                size="icon"
                variant="secondary"
                className="h-8 w-8 rounded-full border border-white/10 bg-white/5 p-0 text-slate-200"
                aria-label="Repeat explanation"
                onClick={() => setPhase('teaching')}
              >
                <Radio className="size-3.5" />
              </Button>
            </div>
            <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-slate-950/30 px-3 py-2.5">
              <span>Regenerate lesson</span>
              <Button
                size="icon"
                variant="secondary"
                className="h-8 w-8 rounded-full border border-white/10 bg-white/5 p-0 text-slate-200"
                aria-label="Regenerate lesson"
                onClick={() => void loadLesson(session.topic, session.preferences, lessonIndex, previousTopics, session.materialIds ?? [])}
              >
                <RefreshCw className="size-3.5" />
              </Button>
            </div>
            <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-slate-950/30 px-3 py-2.5">
              <span>End Lesson</span>
              <Button
                size="icon"
                variant="secondary"
                className="h-8 w-8 rounded-full border border-red-500/20 bg-red-500/5 p-0 text-red-300"
                aria-label="End lesson"
                onClick={endLesson}
              >
                <X className="size-3.5" />
              </Button>
            </div>
          </div>

          {showAskPanel && (
            <div className="fixed right-4 top-20 z-50 w-[340px] rounded-[24px] border border-white/10 bg-slate-950/95 p-2 shadow-[0_30px_80px_rgba(2,6,23,0.9)] backdrop-blur-xl">
              <div className="flex items-center justify-between px-3 py-2">
                <div className="flex items-center gap-2 text-slate-100">
                  <div className="flex size-8 items-center justify-center rounded-full bg-cyan-500/10 text-cyan-300">
                    <Bot className="size-4" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">Ask Maya</p>
                    <p className="text-[11px] text-slate-500">About: {lesson.title}</p>
                  </div>
                </div>
                <Button
                  size="icon"
                  variant="secondary"
                  className="h-8 w-8 rounded-full border border-white/10 bg-white/5 p-0 text-slate-300"
                  aria-label="Close ask panel"
                  onClick={closeAskTeacher}
                >
                  <X className="size-3.5" />
                </Button>
              </div>

              {/* Conversation */}
              {(askThread.length > 0 || askSending) && (
                <div className="max-h-64 overflow-y-auto px-3 pb-2">
                  <div className="flex flex-col gap-2.5">
                    {askThread.map((turn, i) => (
                      <div
                        key={i}
                        className={cn(
                          'rounded-2xl px-3 py-2 text-sm',
                          turn.role === 'user'
                            ? 'ml-6 bg-cyan-500/10 text-cyan-50'
                            : 'mr-2 bg-slate-900/70 text-slate-200',
                        )}
                      >
                        {turn.content}
                      </div>
                    ))}

                    {askSending && (
                      <div className="mr-2 flex items-center gap-2 rounded-2xl bg-slate-900/70 px-3 py-2 text-sm text-slate-400">
                        <Loader2 className="size-3.5 animate-spin" />
                        Maya is thinking…
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Follow-up suggestions */}
              {followUps.length > 0 && !askSending && (
                <div className="flex flex-wrap gap-1.5 px-3 pb-2">
                  {followUps.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => void sendAskTeacher(suggestion)}
                      className="rounded-full border border-cyan-400/25 bg-cyan-500/5 px-2.5 py-1 text-left text-[11px] text-cyan-100 transition-colors hover:bg-cyan-500/15"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              )}

              {askError && (
                <p className="mx-3 mb-2 rounded-xl border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-200">
                  {askError}
                </p>
              )}

              <div className="px-3 pb-3">
                <textarea
                  value={askDraft}
                  onChange={(e) => setAskDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      void sendAskTeacher()
                    }
                  }}
                  placeholder="Ask anything about this lesson…"
                  className="min-h-20 w-full rounded-2xl border border-white/10 bg-slate-900/60 p-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-400/50"
                />
                <Button
                  className="mt-2 w-full bg-gradient-to-r from-cyan-500 to-blue-500 text-white disabled:opacity-40"
                  disabled={askSending || askDraft.trim().length === 0}
                  onClick={() => void sendAskTeacher()}
                >
                  {askSending ? 'Sending…' : 'Send'}
                </Button>
              </div>
            </div>
          )}
        </div>
      </aside>
    </div>
  )
}
