'use client'

import { useCallback, useRef, useState } from 'react'
import { Download, Loader2, Video, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  recordLessonVideo,
  type LessonVideoSegment,
} from '@/lib/video/lesson-recorder'
import type { AILesson } from '@/lib/ai/types'

/**
 * Renders the current lesson to a downloadable video.
 *
 * Narration is spoken aloud while recording, so the export doubles as a
 * playback of the whole lesson.
 */

interface LessonVideoButtonProps {
  lesson: AILesson
  language: string
  voice: SpeechSynthesisVoice | null
  /** Called before recording starts so the classroom can stop its own narration. */
  onBeforeRecord?: () => void
  className?: string
}

/** Strips the markdown fence the model wraps visual payloads in. */
function stripFence(payload?: string): string | undefined {
  if (!payload?.trim()) return undefined
  const match = payload.trim().match(/^```(?:\w*)\n?([\s\S]*?)```$/)
  return (match ? match[1] : payload).trim() || undefined
}

function buildSegments(lesson: AILesson): LessonVideoSegment[] {
  const segments: LessonVideoSegment[] = [
    {
      kind: 'Introduction',
      heading: lesson.title,
      narration: lesson.summary,
      keyPoints: lesson.keyPoints,
    },
    {
      kind: lesson.sections?.[0]?.type ?? 'Concept',
      heading: lesson.sections?.[0]?.title ?? 'The core idea',
      narration: lesson.teachingPrompt,
      visual: stripFence(lesson.visualPayload),
      keyPoints: lesson.keyPoints,
    },
  ]

  if (lesson.question?.prompt) {
    segments.push({
      kind: 'Checkpoint',
      heading: 'Check your understanding',
      narration: `${lesson.question.teacherPrompt} ${lesson.question.prompt}`,
      visual: stripFence(lesson.question.visualPayload),
      keyPoints: lesson.question.options ?? [],
    })
  }

  if (lesson.completionMessage) {
    segments.push({
      kind: 'Summary',
      heading: lesson.nextTopicSuggestion
        ? `Up next: ${lesson.nextTopicSuggestion}`
        : 'Well done',
      narration: lesson.completionMessage,
      keyPoints: lesson.keyPoints,
    })
  }

  return segments
}

export function LessonVideoButton({
  lesson,
  language,
  voice,
  onBeforeRecord,
  className,
}: LessonVideoButtonProps) {
  const [recording, setRecording] = useState(false)
  const [progress, setProgress] = useState(0)
  const [label, setLabel] = useState('')
  const [error, setError] = useState('')
  const [result, setResult] = useState<{ url: string; hasAudio: boolean } | null>(null)

  const abortRef = useRef<AbortController | null>(null)

  const start = useCallback(
    async (withAudio: boolean) => {
      onBeforeRecord?.()
      setError('')
      setResult(null)
      setProgress(0)
      setRecording(true)

      const controller = new AbortController()
      abortRef.current = controller

      try {
        const { blob, hasAudio } = await recordLessonVideo({
          lessonTitle: lesson.title,
          language,
          segments: buildSegments(lesson),
          voice,
          withAudio,
          signal: controller.signal,
          onProgress: (fraction, current) => {
            setProgress(fraction)
            setLabel(current)
          },
        })

        setResult({ url: URL.createObjectURL(blob), hasAudio })
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Recording failed.')
      } finally {
        setRecording(false)
        abortRef.current = null
      }
    },
    [lesson, language, voice, onBeforeRecord],
  )

  const filename = `${lesson.title.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'lesson'}.webm`

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {!recording && !result && (
        <div className="flex flex-col gap-1.5">
          <Button
            className="w-full gap-2 bg-gradient-to-r from-cyan-500 to-blue-500 text-white"
            onClick={() => void start(true)}
          >
            <Video className="size-4" />
            Generate lesson video
          </Button>
          <button
            type="button"
            onClick={() => void start(false)}
            className="text-[11px] text-slate-500 transition-colors hover:text-slate-300"
          >
            Record without audio (no permission prompt)
          </button>
        </div>
      )}

      {recording && (
        <div className="rounded-2xl border border-cyan-400/20 bg-cyan-500/5 p-3">
          <div className="flex items-center gap-2 text-sm text-cyan-100">
            <Loader2 className="size-3.5 animate-spin" />
            Recording — Maya is teaching
          </div>
          <p className="mt-1 truncate text-xs text-slate-400">{label}</p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-blue-500 transition-[width] duration-300"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
          <button
            type="button"
            onClick={() => abortRef.current?.abort()}
            className="mt-2 inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-300"
          >
            <X className="size-3" />
            Stop early
          </button>
        </div>
      )}

      {result && (
        <div className="flex flex-col gap-2 rounded-2xl border border-emerald-400/20 bg-emerald-500/5 p-3">
          <video
            src={result.url}
            controls
            className="w-full rounded-xl border border-white/10"
          />
          {!result.hasAudio && (
            <p className="text-[11px] leading-relaxed text-amber-200/90">
              Recorded without audio — captions are burned into every frame. To include
              narration, use “Generate lesson video” and tick <strong>Share tab audio</strong>
              in the browser prompt.
            </p>
          )}
          <div className="flex gap-2">
            <a
              href={result.url}
              download={filename}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-gradient-to-r from-cyan-500 to-blue-500 px-3 py-2 text-sm font-medium text-white"
            >
              <Download className="size-4" />
              Download
            </a>
            <Button
              variant="secondary"
              className="border border-white/10 bg-white/5 text-slate-200"
              onClick={() => setResult(null)}
            >
              Again
            </Button>
          </div>
        </div>
      )}

      {error && (
        <p className="rounded-xl border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-200">
          {error}
        </p>
      )}
    </div>
  )
}
