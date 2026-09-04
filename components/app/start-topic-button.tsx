'use client'

import { useRouter } from 'next/navigation'
import { Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const SESSION_KEY = 'lumina_lesson_session'
const LESSON_CACHE_KEY = 'lumina_active_lesson'

/**
 * Starts a lesson on a specific topic.
 *
 * The dashboard's recommendation used to link straight to /lesson-plan, which
 * serves whatever lesson is cached — so clicking "Start lesson" on a
 * recommendation silently reopened the previous one instead. This writes the
 * session for the recommended topic and clears the stale cache first, so the
 * recommendation actually leads somewhere.
 *
 * Existing preferences are carried over, so a learner working in Hindi at
 * beginner level stays there rather than being reset to defaults.
 */
export function StartTopicButton({
  topic,
  minutes = 20,
  className,
  children,
}: {
  topic: string
  minutes?: number
  className?: string
  children?: React.ReactNode
}) {
  const router = useRouter()

  function start() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY)
      const previous = raw ? (JSON.parse(raw) as { preferences?: Record<string, unknown> }) : null

      sessionStorage.setItem(
        SESSION_KEY,
        JSON.stringify({
          topic,
          materialIds: [],
          preferences: {
            level: previous?.preferences?.level ?? 'Beginner',
            language: previous?.preferences?.language ?? 'English',
            goal: previous?.preferences?.goal ?? 'General curiosity',
            timeMinutes: minutes,
          },
        }),
      )

      // The cached lesson belongs to the previous topic.
      sessionStorage.removeItem(LESSON_CACHE_KEY)
    } catch {
      // sessionStorage unavailable — /lesson-plan falls back to its defaults.
    }

    router.push('/lesson-plan')
  }

  return (
    <Button onClick={start} className={cn('gap-2', className)}>
      {children ?? (
        <>
          <Play className="size-4" />
          Start lesson
        </>
      )}
    </Button>
  )
}
