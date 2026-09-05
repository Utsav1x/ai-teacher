import Link from 'next/link'
import {
  ArrowRight,
  BookOpen,
  Brain,
  Clock,
  LineChart,
  Play,
  Sparkles,
  TrendingUp,
  Library,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Button } from '@/components/ui/button'
import { LinkButton } from '@/components/ui/link-button'
import { PageHeader } from '@/components/app/page-header'
import { StartTopicButton } from '@/components/app/start-topic-button'
import { AdjustGoalButton } from '@/components/app/adjust-goal-button'
import { auth } from '@/auth'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const session = await auth()
  const firstName = session?.user?.name?.split(' ')[0] ?? 'there'
  const [completedLessons, averageAssessment, studyStreak, conceptsMastered, weeklyGoal, recentLessons] = await Promise.all([
    getCompletedLessonCount(),
    getAverageAssessment(),
    getStudyStreak(),
    getConceptsMastered(),
    getWeeklyGoal(),
    getRecentLessons(),
  ])
  const recommendedTopic = await getRecommendedTopic()
  // Built from the queried values directly. Matching real numbers onto a mock
  // template by label meant one renamed label would silently show a fabricated
  // figure — "48 lessons completed" for a learner who has completed none.
  const dashboardStats = [
    {
      label: 'Lessons completed',
      value: String(completedLessons),
      delta: 'From your learning path',
      icon: BookOpen,
    },
    {
      label: 'Study streak',
      value: `${studyStreak} ${studyStreak === 1 ? 'day' : 'days'}`,
      delta: studyStreak > 0 ? 'Keep it going' : 'Finish a lesson to start one',
      icon: Sparkles,
    },
    {
      label: 'Avg. assessment',
      value: averageAssessment === null ? '—' : `${averageAssessment}%`,
      delta: averageAssessment === null ? 'No assessments yet' : 'From your assessments',
      icon: LineChart,
    },
    {
      label: 'Concepts mastered',
      value: String(conceptsMastered),
      delta: conceptsMastered > 0 ? 'Strong assessment areas' : 'None yet',
      icon: Brain,
    },
  ]
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow={`Welcome back, ${firstName}`}
        title="Ready to learn something new?"
        description={
          studyStreak > 0
            ? `You're on a ${studyStreak}-day streak. Pick up where you left off or start a fresh lesson.`
            : 'Complete an assessment to start your learning streak.'
        }
        actions={
          <LinkButton
            href="/start"
            size="lg"
            className="h-10 gap-2 bg-gradient-to-r from-primary to-accent px-4 text-primary-foreground"
          >
            <Sparkles className="size-4" />
            Start New Lesson
          </LinkButton>
        }
      />

      {/* Stats */}
      <section aria-label="Progress stats" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {dashboardStats.map((stat) => {
          const Icon = stat.icon
          return (
            <Card key={stat.label}>
              <CardContent className="flex items-start justify-between p-5">
                <div>
                  <p className="text-sm text-muted-foreground">{stat.label}</p>
                  <p className="mt-2 text-2xl font-semibold tracking-tight">{stat.value}</p>
                  <p className="mt-1 text-xs text-success">{stat.delta}</p>
                </div>
                <span className="grid size-10 place-items-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
                  <Icon className="size-5" />
                </span>
              </CardContent>
            </Card>
          )
        })}
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Your Library (Recent Lessons) */}
        <section aria-label="Your Library" className="lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Library className="size-5 text-primary" />
              Your Library
            </h2>
            <Link
              href="/progress/path"
              className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              View all
              <ArrowRight className="size-4" />
            </Link>
          </div>
          {recentLessons.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {recentLessons.map((lesson) => (
                <Card key={lesson.id} className="transition-colors hover:border-primary/40 flex flex-col justify-between">
                  <CardContent className="p-5 flex flex-col h-full gap-4">
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <Badge variant="outline" className="shrink-0 text-xs">
                          {lesson.status === 'completed' ? 'Completed' : 'In Progress'}
                        </Badge>
                        <span className="text-xs text-muted-foreground truncate">
                          {lesson.updatedAt}
                        </span>
                      </div>
                      <h3 className="font-medium line-clamp-2">{lesson.title}</h3>
                      <div className="mt-3 flex items-center gap-3">
                        <Progress value={lesson.progress} className="h-1.5" />
                        <span className="w-8 shrink-0 text-right text-xs font-medium text-muted-foreground">
                          {lesson.progress}%
                        </span>
                      </div>
                    </div>
                    <LinkButton
                      href={`/classroom?lessonId=${encodeURIComponent(lesson.engineKey)}`}
                      variant="outline"
                      size="sm"
                      className="w-full gap-1.5 mt-auto"
                    >
                      <Play className="size-3.5" />
                      {lesson.status === 'completed' ? 'Review' : 'Resume'}
                    </LinkButton>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="flex flex-col items-start gap-3 p-5">
                <p className="text-sm text-muted-foreground">
                  You haven't started any lessons yet. Start a new lesson and it will appear here.
                </p>
                <LinkButton href="/start" size="sm" className="gap-1.5">
                  <Play className="size-3.5" />
                  Start learning
                </LinkButton>
              </CardContent>
            </Card>
          )}
        </section>

        {/* Recommended */}
        <section aria-label="Recommended topic" className="flex flex-col gap-6 lg:col-start-3 lg:row-start-1 lg:row-span-2">
          <h2 className="text-lg font-semibold">Recommended for you</h2>
          <Card className="relative overflow-hidden glow-border">
            <div className="pointer-events-none absolute -right-8 -top-8 size-32 rounded-full bg-primary/20 blur-2xl" />
            <CardContent className="relative flex flex-col gap-4 p-5">
              <Badge className="w-fit gap-1.5">
                <TrendingUp className="size-3.5" />
                Recommended
              </Badge>
              <div>
                <p className="text-sm text-muted-foreground">{recommendedTopic.subject}</p>
                <h3 className="mt-1 text-lg font-semibold">{recommendedTopic.title}</h3>
              </div>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {recommendedTopic.reason}
              </p>
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Clock className="size-4" />
                {recommendedTopic.minutes} min lesson
              </div>
              <StartTopicButton
                topic={recommendedTopic.title}
                minutes={recommendedTopic.minutes}
                className="mt-1 w-full justify-center bg-gradient-to-r from-primary to-accent text-primary-foreground"
              />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex flex-col gap-3 p-5">
              <h3 className="font-medium">Weekly goal</h3>
              <div className="flex items-center gap-3">
                <Progress value={weeklyGoal.progress} className="h-2" />
                <span className="text-sm font-medium text-muted-foreground">{weeklyGoal.progress}%</span>
              </div>
              <p className="text-sm text-muted-foreground">
                {formatStudyTime(weeklyGoal.completedMinutes)} of {formatStudyTime(weeklyGoal.goalMinutes)} completed this week.
              </p>
              <AdjustGoalButton currentGoal={weeklyGoal.goalMinutes} />
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  )
}

async function getCompletedLessonCount() {
  const supabase = await createSupabaseServerClient()
  if (!supabase) return 0

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return 0

  const { count } = await supabase
    .from('lesson_progress')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('status', 'completed')

  return count ?? 0
}

/** The `lessons` row embedded in a lesson_progress query. */
type JoinedLesson = {
  id: string
  title: string
  is_default: boolean
  content: { engineKey?: string } | null
}

async function getRecentLessons() {
  const supabase = await createSupabaseServerClient()
  if (!supabase) return []

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data } = await supabase
    .from('lesson_progress')
    .select(`
      status,
      progress_percentage,
      updated_at,
      lessons!inner (
        id,
        title,
        is_default,
        content
      )
    `)
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false })
    .limit(4)

  if (!data) return []

  return data.map((row) => {
    // PostgREST returns a single object for this many-to-one join, but the
    // generated types describe every embedded relation as an array. The rest of
    // the app narrows these the same way — see app/(app)/progress/path/page.tsx.
    const lesson = row.lessons as unknown as JoinedLesson

    return {
      id: lesson.id,
      title: lesson.title,
      status: row.status,
      progress: Math.round(row.progress_percentage),
      updatedAt: new Date(row.updated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      engineKey: lesson.content?.engineKey ?? lesson.id,
    }
  })
}

async function getAverageAssessment() {
  const supabase = await createSupabaseServerClient()
  if (!supabase) return null

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase
    .from('assessment_results')
    .select('score')
    .eq('user_id', user.id)

  if (!data?.length) return null

  const average = data.reduce((sum, result) => sum + Number(result.score), 0) / data.length
  return Math.round(average)
}

async function getStudyStreak() {
  const supabase = await createSupabaseServerClient()
  if (!supabase) return 0

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return 0

  const { data } = await supabase
    .from('learning_activity')
    .select('activity_date')
    .eq('user_id', user.id)

  if (!data?.length) return 0

  const activeDates = new Set(data.map((activity) => String(activity.activity_date)))
  const today = new Date()
  const todayKey = getLocalDateKey(today.toISOString())
  let streak = 0

  for (let dayOffset = 0; ; dayOffset += 1) {
    const date = new Date(today)
    date.setDate(today.getDate() - dayOffset)
    const dateKey = dayOffset === 0 ? todayKey : getLocalDateKey(date.toISOString())
    if (!activeDates.has(dateKey)) break
    streak += 1
  }

  return streak
}

function getLocalDateKey(isoDate: string) {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(isoDate))
}

/**
 * What the learner should study next, derived from their own history.
 *
 * Prefers the weakest concept from the most recent assessment — the thing they
 * demonstrably have not got yet. Falls back to a lesson they started and did
 * not finish, and finally to a generic prompt for a learner with no history.
 */
async function getRecommendedTopic(): Promise<{
  subject: string
  title: string
  reason: string
  minutes: number
}> {
  const fallback = {
    subject: 'Get started',
    title: 'Pick a topic or upload your material',
    reason: 'Once you finish a lesson, recommendations here follow your own results.',
    minutes: 20,
  }

  const supabase = await createSupabaseServerClient()
  if (!supabase) return fallback

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return fallback

  // 1. Weakest concept from the latest assessment.
  const { data: latest } = await supabase
    .from('assessment_results')
    .select('weak, score, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const weakAreas = Array.isArray(latest?.weak) ? latest.weak : []
  const weakest = weakAreas
    .filter((a) => a && typeof a.area === 'string')
    .sort((a, b) => Number(a.mastery ?? 0) - Number(b.mastery ?? 0))[0]

  if (weakest) {
    return {
      subject: 'Needs revision',
      title: String(weakest.area),
      reason: `You scored ${latest?.score ?? 0}% last time, and this concept was the weakest. Revisiting it first will make the next lesson easier.`,
      minutes: 15,
    }
  }

  // 2. Something started but not finished.
  const { data: unfinished } = await supabase
    .from('lesson_progress')
    .select('progress_percentage, lessons(title)')
    .eq('user_id', user.id)
    .neq('status', 'completed')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const title = (unfinished as { lessons?: { title?: string } } | null)?.lessons?.title
  if (title) {
    return {
      subject: 'Continue where you left off',
      title,
      reason: `You are ${unfinished?.progress_percentage ?? 0}% through this lesson.`,
      minutes: 20,
    }
  }

  return fallback
}

async function getConceptsMastered() {
  const supabase = await createSupabaseServerClient()
  if (!supabase) return 0

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return 0

  const { data } = await supabase
    .from('assessment_results')
    .select('strong')
    .eq('user_id', user.id)

  const masteredAreas = new Set<string>()
  for (const result of data ?? []) {
    const strongAreas = Array.isArray(result.strong) ? result.strong : []
    for (const area of strongAreas) {
      if (
        area &&
        typeof area.area === 'string' &&
        Number(area.mastery) >= 70
      ) {
        masteredAreas.add(area.area)
      }
    }
  }

  return masteredAreas.size
}

async function getWeeklyGoal() {
  const supabase = await createSupabaseServerClient()
  if (!supabase) return { completedMinutes: 0, progress: 0, goalMinutes: 300 }

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { completedMinutes: 0, progress: 0, goalMinutes: 300 }

  const today = new Date()
  const daysSinceMonday = (today.getUTCDay() + 6) % 7
  const weekStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - daysSinceMonday))
    .toISOString()
    .slice(0, 10)

  const { data } = await supabase
    .from('learning_activity')
    .select('study_minutes')
    .eq('user_id', user.id)
    .gte('activity_date', weekStart)

  const completedMinutes = (data ?? []).reduce(
    (sum, activity) => sum + Number(activity.study_minutes ?? 0),
    0,
  )

  const goalMinutes = user.user_metadata?.weekly_goal_minutes || 300

  return {
    completedMinutes,
    goalMinutes,
    progress: Math.min(100, Math.round((completedMinutes / goalMinutes) * 100)),
  }
}

function formatStudyTime(minutes: number) {
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  if (hours === 0) return `${remainingMinutes} min`
  if (remainingMinutes === 0) return `${hours}h`
  return `${hours}h ${remainingMinutes}m`
}
