'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle,
  Bot,
  Check,
  Play,
  Clock,
  BookOpen,
  FlaskConical,
  Dumbbell,
  CircleCheckBig,
  Layers,
  Loader2,
  RefreshCw,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/app/page-header'
import type { AILesson, AILessonSection, LearnerPreferences } from '@/lib/ai/types'

const SESSION_KEY = 'lumina_lesson_session'
const LESSON_CACHE_KEY = 'lumina_active_lesson'

/**
 * Identifies what a cached lesson was generated for.
 *
 * Everything the learner can change must be in here. Keying on topic alone
 * meant switching from Hindi to English on the same topic silently reused the
 * Hindi lesson — the badges said English while every word was Hindi.
 */
function sessionSignature(s: {
  topic: string
  materialIds?: string[]
  preferences: LearnerPreferences
}): string {
  return [
    s.topic.trim(),
    s.preferences.language,
    s.preferences.level,
    s.preferences.goal,
    s.preferences.timeMinutes,
    [...(s.materialIds ?? [])].sort().join(','),
  ].join('|')
}

type LessonSession = {
  topic: string
  /** Uploaded material ids. Retrieval is skipped entirely when this is empty. */
  materialIds?: string[]
  preferences: LearnerPreferences
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

const typeMeta: Record<
  AILessonSection['type'],
  { icon: typeof BookOpen; variant: 'default' | 'accent' | 'warning' | 'success' }
> = {
  Concept: { icon: BookOpen, variant: 'default' },
  Example: { icon: FlaskConical, variant: 'accent' },
  Practice: { icon: Dumbbell, variant: 'warning' },
  Checkpoint: { icon: CircleCheckBig, variant: 'success' },
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

export default function LessonPlanPage() {
  const router = useRouter()

  const [session, setSession] = useState<LessonSession>(DEFAULT_SESSION)
  const [lesson, setLesson] = useState<AILesson | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')

  const generate = useCallback(async (s: LessonSession) => {
    setState('loading')
    setError('')

    try {
      const res = await fetch('/api/teacher/generate-lesson', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: s.topic,
          materialIds: s.materialIds ?? [],
          preferences: s.preferences,
          lessonIndex: 0,
          previousTopics: [],
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data?.error ?? `Lesson planning failed (HTTP ${res.status}).`)
        setState('error')
        return
      }

      const generated = data.lesson as AILesson
      setLesson(generated)
      setState('ready')

      // Hand the generated lesson to the classroom so it does not regenerate.
      try {
        sessionStorage.setItem(
          LESSON_CACHE_KEY,
          JSON.stringify({ signature: sessionSignature(s), lesson: generated }),
        )
      } catch {
        // sessionStorage unavailable — the classroom will regenerate instead.
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reach the AI teacher.')
      setState('error')
    }
  }, [])

  // React Strict Mode runs effects twice in development. Without this guard the
  // page fires two full generations — and free-tier quota is counted per request
  // per day, so every duplicate is one lesson you cannot generate later.
  const didInit = useRef(false)

  useEffect(() => {
    if (didInit.current) return
    didInit.current = true

    const s = readSession()
    setSession(s)

    // Reuse a cached plan only when every learner choice still matches.
    try {
      const cached = sessionStorage.getItem(LESSON_CACHE_KEY)
      if (cached) {
        const parsed = JSON.parse(cached) as { signature?: string; lesson?: AILesson }
        if (parsed.signature === sessionSignature(s) && parsed.lesson?.sections?.length) {
          setLesson(parsed.lesson)
          setState('ready')
          return
        }
      }
    } catch {
      // fall through to generation
    }

    void generate(s)
  }, [generate])

  function regenerate() {
    try {
      sessionStorage.removeItem(LESSON_CACHE_KEY)
    } catch {
      // ignore
    }
    void generate(session)
  }

  // ── Loading ─────────────────────────────────────────────────────────────────
  if (state === 'loading') {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-5 rounded-2xl border border-border bg-card/40 p-10 text-center">
        <div className="relative grid size-20 place-items-center rounded-full border border-primary/30 bg-primary/10">
          <div className="absolute inset-0 animate-ping rounded-full border border-primary/40" />
          <Bot className="size-8 text-primary" />
        </div>
        <div>
          <p className="text-lg font-semibold">Lumina is building your lesson plan</p>
          <p className="mx-auto mt-1.5 max-w-md text-sm text-muted-foreground">
            Structuring a {session.preferences.timeMinutes}-minute{' '}
            {session.preferences.level.toLowerCase()} lesson on “{session.topic}” in{' '}
            {session.preferences.language}.
          </p>
          <p className="mt-3 text-xs text-muted-foreground">
            This takes about half a minute — the plan is generated once and reused in the classroom.
          </p>
        </div>
        <Loader2 className="size-5 animate-spin text-primary" />
      </div>
    )
  }

  // ── Error ───────────────────────────────────────────────────────────────────
  if (state === 'error' || !lesson) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-5 rounded-2xl border border-destructive/30 bg-destructive/5 p-10 text-center">
        <div className="grid size-14 place-items-center rounded-full border border-destructive/30 bg-destructive/10">
          <AlertTriangle className="size-6 text-destructive" />
        </div>
        <div>
          <p className="text-lg font-semibold">The lesson plan could not be generated</p>
          <p className="mx-auto mt-2 max-w-lg break-words text-sm text-muted-foreground">{error}</p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button onClick={regenerate} className="gap-2">
            <RefreshCw className="size-4" />
            Try again
          </Button>
          <Button variant="secondary" onClick={() => router.push('/start')}>
            Change topic
          </Button>
        </div>
      </div>
    )
  }

  // ── Plan ────────────────────────────────────────────────────────────────────
  const sections = lesson.sections ?? []
  const totalMinutes = sections.reduce((sum, s) => sum + (s.minutes ?? 0), 0)

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Your lesson plan"
        title={lesson.title}
        description={lesson.objective}
        actions={
          <Button
            size="lg"
            onClick={() => router.push('/classroom')}
            className="h-10 gap-2 bg-gradient-to-r from-primary to-accent px-4 text-primary-foreground"
          >
            <Play className="size-4" />
            Start Lesson
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="default">{session.preferences.level}</Badge>
        <Badge variant="accent">{session.preferences.language}</Badge>
        <Badge variant="warning">{session.preferences.goal}</Badge>
        <button
          type="button"
          onClick={regenerate}
          className="ml-auto inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <RefreshCw className="size-3.5" />
          Regenerate plan
        </button>
      </div>

      <Card>
        <CardContent className="p-5">
          <p className="text-sm leading-relaxed text-muted-foreground">{lesson.summary}</p>
        </CardContent>
      </Card>

      {/* Summary */}
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { icon: Layers, label: 'Steps', value: `${sections.length}` },
          { icon: Clock, label: 'Total time', value: `${totalMinutes} min` },
          { icon: Check, label: 'Requested', value: `${session.preferences.timeMinutes} min` },
        ].map((item) => {
          const Icon = item.icon
          return (
            <Card key={item.label}>
              <CardContent className="flex items-center gap-3 p-5">
                <span className="grid size-10 place-items-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
                  <Icon className="size-5" />
                </span>
                <div>
                  <p className="text-sm text-muted-foreground">{item.label}</p>
                  <p className="text-lg font-semibold">{item.value}</p>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* Steps timeline */}
      <ol className="relative flex flex-col gap-3">
        {sections.map((step, index) => {
          const meta = typeMeta[step.type] ?? typeMeta.Concept
          const Icon = meta.icon
          const isLast = index === sections.length - 1
          const isFirst = index === 0

          return (
            <li key={`${step.title}-${index}`} className="relative flex gap-4">
              <div className="flex flex-col items-center">
                <span
                  className={`grid size-10 shrink-0 place-items-center rounded-full border transition-colors ${
                    isFirst
                      ? 'border-primary bg-primary/20 text-primary'
                      : 'border-border bg-card text-muted-foreground'
                  }`}
                >
                  <span className="text-sm font-semibold">{index + 1}</span>
                </span>
                {!isLast && <span className="my-1 w-px flex-1 bg-border" />}
              </div>

              <Card className={`mb-1 flex-1 transition-colors ${isFirst ? 'border-primary/50 glow-border' : ''}`}>
                <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-border bg-muted/40 text-muted-foreground">
                    <Icon className="size-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={meta.variant}>{step.type}</Badge>
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="size-3.5" />
                        {step.minutes} min
                      </span>
                      {isFirst && <Badge variant="default">Starts here</Badge>}
                    </div>
                    <h3 className="mt-2 font-medium">{step.title}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                      {step.description}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </li>
          )
        })}
      </ol>

      <div className="flex justify-center">
        <Button
          size="lg"
          onClick={() => router.push('/classroom')}
          className="h-11 gap-2 bg-gradient-to-r from-primary to-accent px-6 text-base text-primary-foreground"
        >
          <Play className="size-4" />
          Start Lesson in AI Classroom
        </Button>
      </div>
    </div>
  )
}
