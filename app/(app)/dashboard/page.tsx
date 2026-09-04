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
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Button } from '@/components/ui/button'
import { LinkButton } from '@/components/ui/link-button'
import { PageHeader } from '@/components/app/page-header'
import { StartTopicButton } from '@/components/app/start-topic-button'
import { auth } from '@/auth'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const session = await auth()
  const firstName = session?.user?.name?.split(' ')[0] ?? 'there'
  const [currentCourse, completedLessons, averageAssessment, studyStreak, conceptsMastered, weeklyGoal] = await Promise.all([
    getCurrentCourse(),
    getCompletedLessonCount(),
    getAverageAssessment(),
    getStudyStreak(),
    getConceptsMastered(),
    getWeeklyGoal(),
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
        {/* Continue learning */}
        <section aria-label="Continue learning" className="lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Continue learning</h2>
            <Link
              href="/progress/path"
              className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              View all
              <ArrowRight className="size-4" />
            </Link>
          </div>
          {currentCourse ? (
            <Card className="transition-colors hover:border-primary/40">
              <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
                <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 text-primary">
                  <Play className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">
                      {currentCourse.isDefault ? 'Demo path' : 'Your lessons'}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {currentCourse.completedLessons}/{currentCourse.totalLessons} lessons
                    </span>
                  </div>
                  <h3 className="mt-2 truncate font-medium">{currentCourse.title}</h3>
                  <div className="mt-3 flex items-center gap-3">
                    <Progress value={currentCourse.progress} className="h-1.5" />
                    <span className="w-10 shrink-0 text-right text-xs font-medium text-muted-foreground">
                      {currentCourse.progress}%
                    </span>
                  </div>
                </div>
                <LinkButton
                  href="/progress/path"
                  variant="outline"
                  size="lg"
                  className="h-9 shrink-0 gap-1.5"
                >
                  View path
                  <ArrowRight className="size-4" />
                </LinkButton>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="flex flex-col items-start gap-3 p-5">
                <p className="text-sm text-muted-foreground">
                  No lessons yet. Start one and it will appear here with your progress.
                </p>
                <LinkButton href="/start" size="sm" className="gap-1.5">
                  <Play className="size-3.5" />
                  Start your first lesson
                </LinkButton>
              </CardContent>
            </Card>
          )}
        </section>

        {/* Recommended */}
        <section aria-label="Recommended topic" className="flex flex-col gap-6">
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
              <Button variant="outline" className="mt-1 w-full justify-center" disabled>
                Adjust goal (Coming soon)
              </Button>
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  )
}

/**
 * The course to surface on the dashboard.
 *
 * Prefers the learner's own generated lessons over the seeded demo path — the
 * previous version required `is_default`, so it could only ever show the demo
 * and returned nothing at all for a learner who had only ever taken generated
 * lessons.
 */
async function getCurrentCourse() {
  const supabase = await createSupabaseServerClient()
  if (!supabase) return null

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase
    .from('user_courses')
    .select(`
      courses (
        title,
        is_default,
        lessons (
          lesson_progress (status, progress_percentage)
        )
      )
    `)
    .eq('user_id', user.id)

  type CourseShape = {
    title: string
    is_default: boolean
    lessons: Array<{
      lesson_progress: Array<{ status: string; progress_percentage: number }>
    }>
  }

  const courses = (data ?? [])
    .map((row) => {
      const c = row.courses as unknown as CourseShape | CourseShape[] | null
      return Array.isArray(c) ? c[0] : c
    })
    .filter((c): c is CourseShape => !!c && (c.lessons?.length ?? 0) > 0)

  if (courses.length === 0) return null

  // A learner's own lessons matter more than the demo path.
  const course = courses.find((c) => !c.is_default) ?? courses[0]!

  const totalLessons = course.lessons.length
  const completedLessons = course.lessons.filter((lesson) =>
    lesson.lesson_progress?.[0]?.status === 'completed',
  ).length
  const totalProgress = course.lessons.reduce(
    (sum, lesson) => sum + (lesson.lesson_progress?.[0]?.progress_percentage ?? 0),
    0,
  )

  return {
    title: course.title,
    isDefault: course.is_default,
    totalLessons,
    completedLessons,
    progress: Math.round(totalProgress / totalLessons),
  }
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
  if (!supabase) return { completedMinutes: 0, progress: 0 }

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { completedMinutes: 0, progress: 0 }

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

  const goalMinutes = 300 // 5 hours

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
