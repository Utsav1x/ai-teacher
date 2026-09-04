'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { updateWeeklyGoal } from '@/app/(app)/dashboard/actions'

const GOAL_OPTIONS = [
  { label: '1 hour', minutes: 60 },
  { label: '3 hours', minutes: 180 },
  { label: '5 hours', minutes: 300 },
  { label: '10 hours', minutes: 600 },
]

export function AdjustGoalButton({ currentGoal }: { currentGoal: number }) {
  const [isOpen, setIsOpen] = useState(false)
  const [isPending, setIsPending] = useState(false)

  if (!isOpen) {
    return (
      <Button variant="outline" className="mt-1 w-full justify-center" onClick={() => setIsOpen(true)}>
        Adjust goal
      </Button>
    )
  }

  return (
    <div className="mt-2 flex flex-col gap-2">
      <p className="text-xs text-muted-foreground text-center">Select your weekly goal</p>
      <div className="grid grid-cols-2 gap-2">
        {GOAL_OPTIONS.map((opt) => (
          <Button
            key={opt.minutes}
            variant={currentGoal === opt.minutes ? 'default' : 'outline'}
            size="sm"
            disabled={isPending}
            onClick={async () => {
              setIsPending(true)
              await updateWeeklyGoal(opt.minutes)
              setIsPending(false)
              setIsOpen(false)
            }}
          >
            {isPending && currentGoal === opt.minutes ? (
              <Loader2 className="mr-2 size-3 animate-spin" />
            ) : null}
            {opt.label}
          </Button>
        ))}
      </div>
      <Button variant="ghost" size="sm" onClick={() => setIsOpen(false)} disabled={isPending}>
        Cancel
      </Button>
    </div>
  )
}
