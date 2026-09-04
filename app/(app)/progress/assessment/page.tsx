'use client'

import { Suspense, useCallback, useEffect, useRef, useState, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  CircleDashed,
  Clock,
  Loader2,
  RefreshCw,
  Sparkles,
  Target,
  TrendingUp,
  Waypoints,
  XCircle,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { LinkButton } from '@/components/ui/link-button'
import { PageHeader } from '@/components/app/page-header'
import type { AILesson, AIQuestion } from '@/lib/ai/types'

/** Written by /lesson-plan and the classroom — the lesson the student just sat. */
const LESSON_CACHE_KEY = 'lumina_active_lesson'

// ─── Types ────────────────────────────────────────────────────────────────────

type AreaStat    = { area: string; mastery: number }
type ReportData  = {
  score: number
  correct: number
  total: number
  timeSpent: string
  strong: AreaStat[]
  weak: AreaStat[]
  recommendations: string[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AssessmentPage() {
  return (
    <Suspense fallback={
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="size-8 animate-spin text-primary" />
      </div>
    }>
      <AssessmentContent />
    </Suspense>
  )
}

function AssessmentContent() {
  const searchParams = useSearchParams()

  const [lesson, setLesson] = useState<AILesson | null>(null)
  const [noLesson, setNoLesson] = useState(false)

  /**
   * The assessment covers the lesson the student actually sat, read from the
   * cache the classroom writes. Previously this served a hardcoded quiz, so a
   * student who had just finished a Hindi photosynthesis lesson was tested on
   * neural networks.
   */
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(LESSON_CACHE_KEY)
      if (!raw) {
        setNoLesson(true)
        return
      }
      const parsed = JSON.parse(raw) as { lesson?: AILesson }
      if (parsed.lesson?.title) setLesson(parsed.lesson)
      else setNoLesson(true)
    } catch {
      setNoLesson(true)
    }
  }, [])

  /** Every checkpoint from the lesson becomes an assessment question. */
  const questions: AIQuestion[] = useMemo(() => {
    if (!lesson) return []
    return lesson.questions?.length ? lesson.questions : [lesson.question]
  }, [lesson])

  const lessonIdParam = lesson?.id ?? searchParams.get('lessonId') ?? 'lesson'

  // Assessment state
  const [stage,             setStage]             = useState<'intro' | 'quiz' | 'report'>('intro')
  const [answers,           setAnswers]            = useState<Record<string, number>>({})
  const [saving,            setSaving]             = useState(false)
  const [report,            setReport]             = useState<ReportData | null>(null)
  const [loadError,         setLoadError]          = useState<string | null>(null)

  // Timer
  const startTimeRef = useRef<number>(Date.now())

  // Journey breadcrumbs
  const journeySteps = [
    { label: 'Lesson complete', done: true },
    { label: 'Assessment',      done: stage !== 'intro' },
    { label: 'Learning report', done: stage === 'report' },
  ]

  const questionIdFor = (index: number) => `${lessonIdParam}-q${index + 1}`
  const answeredCount = questions.filter((_, i) => answers[questionIdFor(i)] !== undefined).length
  const allAnswered = questions.length > 0 && answeredCount === questions.length

  // ── Load previous result on mount ──
  useEffect(() => {
    async function loadPrevious() {
      try {
        const res = await fetch(`/api/progress/assessment?lessonId=${lessonIdParam}`)
        if (!res.ok) return
        const data = await res.json() as { result: ReportData | null }
        if (data.result) {
          setReport(data.result)
          setStage('report')
        }
      } catch {
        // silently ignore — fresh start
      }
    }
    void loadPrevious()
  }, [lessonIdParam])

  // ── Submit and save ──
  const handleFinish = useCallback(async () => {
    if (!allAnswered) return
    setSaving(true)
    setLoadError(null)

    const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000)

    try {
      const res = await fetch('/api/progress/assessment', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lessonId:         lessonIdParam,
          lessonTitle:      lesson?.title,
          answers: questions.map((q, i) => ({
            questionId: questionIdFor(i),
            selectedIndex: answers[questionIdFor(i)],
            correctIndex: q.correctIndex,
            concept: q.concept,
          })),
          timeSpentSeconds: elapsed,
        }),
      })
      const data = await res.json() as ReportData & { error?: string }
      if (data.error && !data.score) {
        setLoadError(data.error)
        return
      }
      setReport(data)
      setStage('report')
    } catch (err) {
      setLoadError('Could not save result. Check your connection and try again.')
    } finally {
      setSaving(false)
    }
  }, [allAnswered, answers, lesson?.title, lessonIdParam, questions])

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Lesson journey"
        title={
          stage === 'report'
            ? 'Learning Report'
            : stage === 'quiz'
            ? 'Assessment'
            : 'Lesson Complete'
        }
        description={
          stage === 'report'
            ? `Results for "${lesson?.title}" — see what landed and what to revisit.`
            : stage === 'quiz'
            ? 'Answer the checkpoint question before seeing your results.'
            : 'You just finished the live AI lesson. Take a quick check and then review your results.'
        }
      />

      {/* Loading state */}
      {!lesson && (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="size-8 animate-spin text-primary" />
        </div>
      )}

      {loadError && (
        <p className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
          {loadError}
        </p>
      )}

      {/* Journey breadcrumb */}
      <div className="flex flex-wrap items-center gap-2">
        {journeySteps.map((step, i) => (
          <div key={step.label} className="flex items-center gap-2">
            <div className={cn(
              'flex size-7 items-center justify-center rounded-full border text-xs font-semibold',
              step.done
                ? 'border-primary/40 bg-primary/15 text-primary'
                : 'border-border bg-secondary/60 text-muted-foreground',
            )}>
              {i + 1}
            </div>
            <span className={cn('text-sm', step.done ? 'text-foreground' : 'text-muted-foreground')}>
              {step.label}
            </span>
            {i < journeySteps.length - 1 && <ArrowRight className="size-4 text-muted-foreground" />}
          </div>
        ))}
      </div>

      {/* ── INTRO ── */}
      {stage === 'intro' && lesson && (
        <Card className="border-primary/30 bg-gradient-to-br from-primary/10 via-background to-accent/5">
          <CardContent className="flex flex-col gap-6 p-6 sm:p-8">
            <div className="flex items-center gap-2 text-primary">
              <CheckCircle2 className="size-5" />
              <span className="text-sm font-medium uppercase tracking-[0.2em]">Lesson complete</span>
            </div>
            <div className="space-y-2">
              <h2 className="text-3xl font-semibold tracking-tight">{lesson.title}</h2>
              <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">{lesson.summary}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {lesson.keyPoints.map((pt) => (
                <Badge key={pt} variant="secondary" className="rounded-full border border-primary/20 bg-primary/5 text-primary">
                  {pt}
                </Badge>
              ))}
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => { startTimeRef.current = Date.now(); setStage('quiz') }}
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-primary to-accent px-5 py-3 text-sm font-medium text-primary-foreground"
              >
                Start assessment
                <ArrowRight className="size-4" />
              </button>
              <LinkButton href="/progress/path" variant="outline" className="h-11 px-5">
                View learning path
              </LinkButton>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── QUIZ ── */}
      {stage === 'quiz' && lesson && (
        <>
          {/* Progress indicator */}
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="flex items-center justify-between p-5">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Assessment progress</p>
                <p className="mt-1 text-2xl font-semibold">
                  {answeredCount}/{questions.length}
                </p>
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <CircleDashed className="size-4 text-primary" />
                {questions.length - answeredCount} remaining
              </div>
            </CardContent>
          </Card>

          {/* One card per generated checkpoint */}
          {questions.map((question, qIndex) => {
            const qId = questionIdFor(qIndex)
            const picked = answers[qId]
            const isAnswered = picked !== undefined
            const isCorrect = picked === question.correctIndex

            return (
              <Card key={qId}>
                <CardContent className="flex flex-col gap-4 p-5 sm:p-6">
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-medium leading-snug">
                      <span className="mr-2 text-muted-foreground">{qIndex + 1}.</span>
                      {question.prompt}
                    </p>
                    <div className="flex shrink-0 items-center gap-2">
                      {question.difficulty && (
                        <Badge variant="secondary" className="rounded-full text-[10px] uppercase">
                          {question.difficulty}
                        </Badge>
                      )}
                      {isAnswered && (
                        isCorrect
                          ? <CheckCircle2 className="size-5 text-success" />
                          : <XCircle className="size-5 text-destructive" />
                      )}
                    </div>
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2">
                    {question.options?.map((opt: string, i: number) => {
                      const isPicked    = picked === i
                      const showCorrect = isAnswered && i === question.correctIndex
                      const showWrong   = isAnswered && isPicked && !showCorrect
                      return (
                        <button
                          key={opt}
                          type="button"
                          disabled={isAnswered}
                          onClick={() => setAnswers((prev) => ({ ...prev, [qId]: i }))}
                          className={cn(
                            'flex items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm transition-colors',
                            'border-border bg-secondary/30',
                            !isAnswered && 'hover:border-primary/40',
                            showCorrect && 'border-success/60 bg-success/10',
                            showWrong   && 'border-destructive/60 bg-destructive/10',
                            isAnswered && !showCorrect && !showWrong && 'opacity-50',
                          )}
                        >
                          <span className={cn(
                            'flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium',
                            showCorrect ? 'border-success bg-success text-success-foreground'
                              : showWrong ? 'border-destructive bg-destructive text-destructive-foreground'
                              : 'border-border text-muted-foreground',
                          )}>
                            {String.fromCharCode(65 + i)}
                          </span>
                          {opt}
                        </button>
                      )
                    })}
                  </div>

                  {isAnswered && (
                    <div className={cn(
                      'rounded-xl border p-4 text-sm leading-relaxed',
                      isCorrect ? 'border-success/30 bg-success/10' : 'border-warning/30 bg-warning/10',
                    )}>
                      <p className="mb-1 font-medium">{isCorrect ? 'Correct!' : 'Not quite.'}</p>
                      {question.explanation}
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          })}

          {allAnswered && (
            <button
              type="button"
              disabled={saving}
              onClick={handleFinish}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-primary to-accent px-5 py-3 text-sm font-medium text-primary-foreground disabled:opacity-60"
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
              {saving ? 'Saving results…' : 'Finish & view report'}
            </button>
          )}
        </>
      )}

      {/* ── REPORT ── */}
      {stage === 'report' && report && (
        <ReportView report={report} nextTopic={lesson?.nextTopicSuggestion} />
      )}
    </div>
  )
}

// ─── Report view (no mock data) ───────────────────────────────────────────────

function ReportView({
  report,
  nextTopic,
}: {
  report: ReportData
  /** Comes from the generated lesson, not a fixed curriculum. */
  nextTopic?: string
}) {
  const hasWeak = report.weak.length > 0

  return (
    <div className="flex flex-col gap-6">
      {/* Score hero */}
      <Card className="border-primary/30 bg-gradient-to-br from-primary/10 via-background to-accent/5">
        <CardContent className="flex flex-col items-center gap-4 p-6 text-center sm:flex-row sm:justify-between sm:text-left">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Session result</p>
            <p className="mt-1 text-4xl font-semibold tracking-tight">{report.score}%</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {report.correct} of {report.total} correct · {report.timeSpent}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <div className="flex items-center gap-1.5 text-success">
              <CheckCircle2 className="size-4" />
              {report.correct} correct
            </div>
            <div className="flex items-center gap-1.5 text-destructive">
              <XCircle className="size-4" />
              {report.total - report.correct} missed
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stats row */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { icon: Target,       label: 'Score',       value: `${report.score}%`                     },
          { icon: CheckCircle2, label: 'Correct',      value: `${report.correct}/${report.total}`     },
          { icon: Clock,        label: 'Time spent',   value: report.timeSpent                        },
          { icon: TrendingUp,   label: 'Avg. mastery', value: `${report.score}%`                     },
        ].map(({ icon: Icon, label, value }) => (
          <Card key={label} className="border-primary/20 bg-gradient-to-br from-primary/5 to-background">
            <CardContent className="flex items-center gap-3 p-5">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
                <Icon className="size-5" />
              </span>
              <div>
                <p className="text-sm text-muted-foreground">{label}</p>
                <p className="text-xl font-semibold">{value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Strong / Weak areas */}
      <div className="grid gap-6 lg:grid-cols-2">
        {report.strong.length > 0 && (
          <Card>
            <CardContent className="flex flex-col gap-4 p-5">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="size-4 text-success" />
                <h2 className="font-semibold">Strong areas</h2>
              </div>
              <div className="flex flex-col gap-4">
                {report.strong.map((item) => (
                  <div key={item.area} className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between text-sm">
                      <span>{item.area}</span>
                      <Badge variant="success">{item.mastery}%</Badge>
                    </div>
                    <MasteryBar value={item.mastery} variant="success" />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {hasWeak && (
          <Card>
            <CardContent className="flex flex-col gap-4 p-5">
              <div className="flex items-center gap-2">
                <AlertTriangle className="size-4 text-warning" />
                <h2 className="font-semibold">Needs revision</h2>
              </div>
              <div className="flex flex-col gap-4">
                {report.weak.map((item) => (
                  <div key={item.area} className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between text-sm">
                      <span>{item.area}</span>
                      <Badge variant="warning">{item.mastery}%</Badge>
                    </div>
                    <MasteryBar value={item.mastery} variant="warning" />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Recommendations */}
      {report.recommendations.length > 0 && (
        <Card>
          <CardContent className="flex flex-col gap-4 p-5">
            <div className="flex items-center gap-2">
              <Sparkles className="size-4 text-primary" />
              <h2 className="font-semibold">Revision guide</h2>
            </div>
            <ol className="flex flex-col gap-3">
              {report.recommendations.map((rec, i) => (
                <li key={i} className="flex gap-3 text-sm">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary/10 text-xs font-semibold text-primary">
                    {i + 1}
                  </span>
                  <span className="leading-relaxed text-muted-foreground">{rec}</span>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      )}

      {/* Next topic suggestion — from the lesson the AI just generated */}
      {nextTopic && (
        <Card>
          <CardContent className="flex flex-col gap-4 p-5">
            <div className="flex items-center gap-2">
              <ArrowRight className="size-4 text-accent" />
              <h2 className="font-semibold">Suggested next topic</h2>
            </div>
            <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4">
              <p className="text-lg font-semibold">{nextTopic}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Maya suggested this as the natural next step after this lesson.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Action bar — keeps user in learning journey */}
      <div className="rounded-2xl border border-border bg-card/40 p-5">
        <p className="mb-4 text-sm font-medium text-foreground">What would you like to do next?</p>
        <div className="flex flex-wrap gap-3">
          {hasWeak && (
            <LinkButton
              href="/classroom"
              size="lg"
              className="h-11 gap-2 bg-gradient-to-r from-primary to-accent px-5 text-primary-foreground"
            >
              <RefreshCw className="size-4" />
              Revise Weak Area
            </LinkButton>
          )}
          <LinkButton
            href="/start"
            size="lg"
            variant={hasWeak ? 'outline' : undefined}
            className={cn('h-11 gap-2 px-5', !hasWeak && 'bg-gradient-to-r from-primary to-accent text-primary-foreground')}
          >
            <BookOpen className="size-4" />
            Start Next Lesson
          </LinkButton>
          <LinkButton
            href="/progress/path"
            size="lg"
            variant="secondary"
            className="h-11 gap-2 px-5"
          >
            <Waypoints className="size-4" />
            View Learning Path
          </LinkButton>
        </div>
      </div>
    </div>
  )
}

function MasteryBar({ value, variant }: { value: number; variant: 'success' | 'warning' }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-secondary/60">
      <div
        className={cn(
          'h-full rounded-full transition-all duration-700',
          variant === 'success' ? 'bg-success' : 'bg-warning',
        )}
        style={{ width: `${value}%` }}
      />
    </div>
  )
}
