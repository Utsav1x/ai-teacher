'use client'

import {
  Braces,
  GitBranch,
  LineChart,
  Sigma,
  Table2,
  History,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { VisualType } from '@/lib/ai/types'

/**
 * Renders the lesson's blackboard visual in the form the subject calls for.
 *
 * The model declares `visualType` when it generates the lesson, so the choice
 * between a formula, a diagram, a timeline and running code is an explicit
 * decision rather than a side effect of free-form text. Showing that choice —
 * and the one-line reason behind it — is what makes the system's visual
 * reasoning inspectable instead of implied.
 */

const VISUAL_META: Record<
  VisualType,
  { label: string; icon: LucideIcon; accent: string; mono: boolean; size: string }
> = {
  code: {
    label: 'Code & output',
    icon: Braces,
    accent: 'text-emerald-300 border-emerald-400/20 bg-emerald-500/5',
    mono: true,
    size: 'text-xs',
  },
  formula: {
    label: 'Equation',
    icon: Sigma,
    accent: 'text-violet-200 border-violet-400/20 bg-violet-500/5',
    mono: true,
    // Formulae are read symbol by symbol, so they get more room.
    size: 'text-sm leading-7 tracking-wide',
  },
  diagram: {
    label: 'Diagram',
    icon: GitBranch,
    accent: 'text-cyan-200 border-cyan-400/20 bg-cyan-500/5',
    mono: true,
    size: 'text-xs',
  },
  timeline: {
    label: 'Timeline',
    icon: History,
    accent: 'text-amber-200 border-amber-400/20 bg-amber-500/5',
    mono: true,
    size: 'text-xs leading-6',
  },
  table: {
    label: 'Comparison',
    icon: Table2,
    accent: 'text-sky-200 border-sky-400/20 bg-sky-500/5',
    mono: true,
    size: 'text-xs',
  },
  graph: {
    label: 'Plot',
    icon: LineChart,
    accent: 'text-rose-200 border-rose-400/20 bg-rose-500/5',
    mono: true,
    size: 'text-xs leading-5',
  },
}

const FALLBACK = {
  label: 'Visual',
  icon: GitBranch,
  accent: 'text-slate-200 border-white/10 bg-white/5',
  mono: true,
  size: 'text-xs',
}

interface LessonVisualProps {
  body: string
  /** Fence language tag, e.g. "python". Only meaningful for code. */
  language?: string
  visualType?: VisualType
  rationale?: string
  className?: string
}

export function LessonVisual({
  body,
  language,
  visualType,
  rationale,
  className,
}: LessonVisualProps) {
  const meta = visualType ? VISUAL_META[visualType] : FALLBACK

  // Code keeps its language tag; everything else is described by its form.
  const heading =
    visualType === 'code' && language ? `${meta.label} · ${language}` : meta.label

  const Icon = meta.icon

  return (
    <figure className={cn('overflow-hidden rounded-2xl border border-white/10 bg-slate-950/60', className)}>
      <figcaption
        className={cn(
          'flex flex-wrap items-center gap-2 border-b px-3 py-2 text-[10px] uppercase tracking-[0.18em]',
          meta.accent,
        )}
      >
        <Icon className="size-3.5" />
        {heading}
      </figcaption>

      <pre
        className={cn(
          'overflow-x-auto p-4 text-cyan-100',
          meta.mono && 'font-mono',
          meta.size,
        )}
      >
        {body}
      </pre>

      {rationale && (
        <p className="border-t border-white/5 px-3 py-2 text-[11px] leading-relaxed text-slate-500">
          <span className="text-slate-400">Why this form: </span>
          {rationale}
        </p>
      )}
    </figure>
  )
}
