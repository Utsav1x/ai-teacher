import {
  BookOpen,
  CheckCircle2,
  Clock,
  Lock,
  Play,
  Sparkles,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { LinkButton } from '@/components/ui/link-button'
import { PageHeader } from '@/components/app/page-header'
import { auth } from '@/auth'
import { createSupabaseServerClient } from '@/lib/supabase/server'

// ─── Types (mirrored from the API route) ─────────────────────────────────────

type LessonStatus = 'not_started' | 'in_progress' | 'completed'

type PathLesson = {
  id: string
  title: string
  description: string | null
  orderIndex: number
  status: LessonStatus
  progressPct: number
  engineKey: string | null
  completedAt: string | null
}

type PathCourse = {
  id: string
  title: string
  description: string | null
  isDefault: boolean
  lessons: PathLesson[]
}

// Maps lesson DB titles → engine key (classroom URL param)
const TITLE_TO_ENGINE_KEY: Record<string, string> = {
  'Introduction to Neural Networks': 'ai-teacher-demo-lesson-1',
  'How Neural Networks Learn':       'ai-teacher-demo-lesson-2',
}

// ─── Data fetching (server-side, no round-trip) ───────────────────────────────

async function getUserLearningPath(userId: string): Promise<PathCourse[]> {
  const supabase = await createSupabaseServerClient()
  if (!supabase) return []

  const { data: rows, error } = await supabase
    .from('user_courses')
    .select(`
      course_id,
      courses (
        id,
        title,
        description,
        is_default,
        lessons (
          id,
          title,
          description,
          order_index,
          lesson_progress (
            status,
            progress_percentage,
            completed_at
          )
        )
      )
    `)
    .eq('user_id', userId)
    .order('created_at', { ascending: true })

  if (error || !rows) return []

  return rows.flatMap((row) => {
    const course = row.courses as unknown as {
      id: string
      title: string
      description: string | null
      is_default: boolean
      lessons: Array<{
        id: string
        title: string
        description: string | null
        order_index: number
        lesson_progress: Array<{
          status: string
          progress_percentage: number
          completed_at: string | null
        }>
      }>
    }

    if (!course) return []

    const lessons: PathLesson[] = (course.lessons ?? [])
      .sort((a, b) => a.order_index - b.order_index)
      .map((lesson) => {
        const progress = lesson.lesson_progress?.[0]
        const status   = (progress?.status ?? 'not_started') as LessonStatus
        return {
          id:          lesson.id,
          title:       lesson.title,
          description: lesson.description,
          orderIndex:  lesson.order_index,
          status,
          progressPct: Number(progress?.progress_percentage ?? 0),
          engineKey:   TITLE_TO_ENGINE_KEY[lesson.title] ?? null,
          completedAt: progress?.completed_at ?? null,
        }
      })

    return [{ id: course.id, title: course.title, description: course.description, isDefault: course.is_default, lessons }]
  })
}

// ─── Status helpers ───────────────────────────────────────────────────────────

const statusLabel: Record<LessonStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  completed:   'Complete',
}

const statusBadgeVariant: Record<LessonStatus, 'secondary' | 'default' | 'success'> = {
  not_started: 'secondary',
  in_progress: 'default',
  completed:   'success',
}

// Classroom href: use engine key if available, fall back to base classroom
function classroomHref(engineKey: string | null): string {
  if (!engineKey) return '/classroom'
  return `/classroom?lessonId=${engineKey}`
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function LearningPathPage() {
  const session = await auth()
  const userId  = session?.user?.id

  const courses   = userId ? await getUserLearningPath(userId) : []
  const allLessons = courses.flatMap((c) => c.lessons)

  const completedCount  = allLessons.filter((l) => l.status === 'completed').length
  const inProgressCount = allLessons.filter((l) => l.status === 'in_progress').length
  const totalCount      = allLessons.length

  // The "active" lesson to highlight: first in_progress, or first not_started
  const activeLessonKey =
    allLessons.find((l) => l.status === 'in_progress')?.engineKey ??
    allLessons.find((l) => l.status === 'not_started')?.engineKey ??
    null

  // ── Empty state ──
  if (courses.length === 0) {
    return (
      <div className="flex flex-col gap-8">
        <PageHeader eyebrow="Progress" title="Learning Path" description="Your personalised roadmap." />
        <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-background">
          <CardContent className="flex flex-col items-center gap-6 p-10 text-center">
            <span className="grid size-16 place-items-center rounded-2xl border border-primary/20 bg-primary/10 text-primary">
              <Sparkles className="size-8" />
            </span>
            <div className="space-y-2">
              <h2 className="text-xl font-semibold">No lessons yet</h2>
              <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
                Start your first lesson and it will appear here automatically.
              </p>
            </div>
            <LinkButton href="/classroom" size="lg" className="h-11 gap-2 bg-gradient-to-r from-primary to-accent px-5 text-primary-foreground">
              <Play className="size-4" />
              Start learning
            </LinkButton>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Progress"
        title="Learning Path"
        description="Your personalised roadmap. Progress is saved automatically as you learn."
        actions={
          <LinkButton
            href={classroomHref(activeLessonKey)}
            size="lg"
            className="h-10 gap-2 bg-gradient-to-r from-primary to-accent px-4 text-primary-foreground"
          >
            <Play className="size-4" />
            {inProgressCount > 0 ? 'Continue learning' : 'Start learning'}
          </LinkButton>
        }
      />

      {/* Summary bar */}
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div className="flex flex-wrap gap-6">
            <div>
              <p className="text-sm text-muted-foreground">Completed</p>
              <p className="mt-0.5 text-xl font-semibold">{completedCount}<span className="text-sm font-normal text-muted-foreground">/{totalCount}</span></p>
            </div>
            <div className="h-full w-px bg-border" />
            <div>
              <p className="text-sm text-muted-foreground">In progress</p>
              <p className="mt-0.5 text-xl font-semibold">{inProgressCount}</p>
            </div>
            <div className="h-full w-px bg-border" />
            <div>
              <p className="text-sm text-muted-foreground">Not started</p>
              <p className="mt-0.5 text-xl font-semibold">{totalCount - completedCount - inProgressCount}</p>
            </div>
          </div>
          {totalCount > 0 && (
            <Badge variant="default" className="px-3 py-1 text-sm">
              {Math.round((completedCount / totalCount) * 100)}% complete
            </Badge>
          )}
        </CardContent>
      </Card>

      {/* One section per course */}
      {courses.map((course) => (
        <section key={course.id} aria-label={course.title}>
          {/* Course header — only shown if user has more than one course */}
          {courses.length > 1 && (
            <div className="mb-4 flex items-center gap-3">
              <span className="grid size-8 place-items-center rounded-lg border border-primary/20 bg-primary/10 text-primary">
                <BookOpen className="size-4" />
              </span>
              <div>
                <h2 className="font-semibold">{course.title}</h2>
                {course.description && (
                  <p className="text-xs text-muted-foreground">{course.description}</p>
                )}
              </div>
              {course.isDefault && (
                <Badge variant="secondary" className="ml-1">Default</Badge>
              )}
            </div>
          )}

          {course.lessons.length === 0 ? (
            <p className="text-sm text-muted-foreground">No lessons in this course yet.</p>
          ) : (
            <ol className="flex flex-col gap-3">
              {course.lessons.map((lesson, index) => {
                const isLast   = index === course.lessons.length - 1
                const isCurrent = lesson.status === 'in_progress'
                const isDone    = lesson.status === 'completed'
                const isLocked  = lesson.status === 'not_started' && index > 0 &&
                                  course.lessons[index - 1].status !== 'completed'

                return (
                  <li key={lesson.id} className="flex gap-4">
                    {/* Spine */}
                    <div className="flex flex-col items-center">
                      <span className={cn(
                        'grid size-10 shrink-0 place-items-center rounded-full border transition-colors',
                        isDone    && 'border-success bg-success text-success-foreground',
                        isCurrent && 'border-primary bg-primary/20 text-primary',
                        !isDone && !isCurrent && 'border-border bg-card text-muted-foreground/50',
                      )}>
                        {isDone    && <CheckCircle2 className="size-5" />}
                        {isCurrent && <Play className="size-4" />}
                        {!isDone && !isCurrent && (
                          isLocked
                            ? <Lock className="size-4" />
                            : <span className="text-xs font-semibold">{index + 1}</span>
                        )}
                      </span>
                      {!isLast && <span className="my-1 w-px flex-1 bg-border" />}
                    </div>

                    {/* Card */}
                    <Card className={cn(
                      'mb-1 flex-1 transition-colors',
                      isCurrent && 'border-primary/50 glow-border',
                      isLocked  && 'opacity-55',
                    )}>
                      <CardContent className="flex items-start justify-between gap-4 p-5">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant={statusBadgeVariant[lesson.status]}>
                              {statusLabel[lesson.status]}
                            </Badge>
                            {lesson.completedAt && (
                              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                <Clock className="size-3" />
                                {new Date(lesson.completedAt).toLocaleDateString()}
                              </span>
                            )}
                            {isCurrent && lesson.progressPct > 0 && (
                              <span className="text-xs text-muted-foreground">
                                {Math.round(lesson.progressPct)}% through
                              </span>
                            )}
                          </div>
                          <h3 className="mt-2 font-medium">{lesson.title}</h3>
                          {lesson.description && (
                            <p className="mt-1 text-sm text-muted-foreground line-clamp-2">
                              {lesson.description}
                            </p>
                          )}

                          {/* Progress bar for in-progress lessons */}
                          {isCurrent && lesson.progressPct > 0 && (
                            <div className="mt-3 h-1.5 w-48 max-w-full overflow-hidden rounded-full bg-secondary/60">
                              <div
                                className="h-full rounded-full bg-primary/70 transition-all"
                                style={{ width: `${lesson.progressPct}%` }}
                              />
                            </div>
                          )}
                        </div>

                        <div className="shrink-0">
                          {isDone && (
                            <LinkButton
                              href={classroomHref(lesson.engineKey)}
                              variant="outline"
                              size="lg"
                              className="h-9 gap-1.5"
                            >
                              <Play className="size-4" />
                              Review
                            </LinkButton>
                          )}
                          {isCurrent && (
                            <LinkButton
                              href={classroomHref(lesson.engineKey)}
                              variant="outline"
                              size="lg"
                              className="h-9 gap-1.5"
                            >
                              <Play className="size-4" />
                              Resume
                            </LinkButton>
                          )}
                          {lesson.status === 'not_started' && !isLocked && (
                            <LinkButton
                              href={classroomHref(lesson.engineKey)}
                              variant="outline"
                              size="lg"
                              className="h-9 gap-1.5"
                            >
                              Start
                            </LinkButton>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  </li>
                )
              })}
            </ol>
          )}
        </section>
      ))}
    </div>
  )
}
