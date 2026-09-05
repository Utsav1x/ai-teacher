'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  ChevronRight,
  Film,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  SkipBack,
  SkipForward,
  Video,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import type { AILesson } from '@/lib/ai/types'
import type { VideoJob, VideoClip } from '@/lib/video/types'

/**
 * LessonVideoPlayer
 *
 * Renders the AI-generated video experience inside the classroom.
 *
 * States:
 *   idle       — "Generate Teaching Video" button
 *   preparing  — scene plan being built + D-ID clips being submitted
 *   polling    — waiting for D-ID to finish rendering clips
 *   ready      — all clips available; playback begins automatically
 *   playing    — sequential clip playback
 *   paused     — user paused; can resume
 *   question   — paused at a checkpoint scene; hands control back to classroom
 *   error      — generation failed; can retry
 *
 * The component is self-contained: it manages its own polling loop and video
 * element. It calls onQuestionReached when the video reaches a pause point,
 * and onVideoEnd when all scenes have played.
 */

// ─── Polling ──────────────────────────────────────────────────────────────────

/** How often to poll for clip status while D-ID is rendering (ms). */
const POLL_INTERVAL_MS = 4000

/**
 * How long to keep polling before giving up (ms).
 *
 * A clip D-ID never finishes stays 'started' forever, and nothing else here
 * would ever stop asking about it. Six minutes is well past a normal render for
 * the six scenes a job submits.
 */
const POLL_TIMEOUT_MS = 6 * 60_000

// ─── Player state ─────────────────────────────────────────────────────────────

type PlayerState =
  | 'idle'
  | 'preparing'
  | 'polling'
  | 'ready'
  | 'playing'
  | 'paused'
  | 'question'
  | 'error'

// ─── Props ────────────────────────────────────────────────────────────────────

interface LessonVideoPlayerProps {
  lesson: AILesson
  language: string
  /** Called when the video pauses at a question checkpoint. */
  onQuestionReached?: (questionIndex: number) => void
  /** Called when all scenes have finished playing. */
  onVideoEnd?: () => void
  /** Called before generation starts (e.g. to stop other narration). */
  onBeforeGenerate?: () => void
  className?: string
}

// ─── Label helpers ────────────────────────────────────────────────────────────

const STATE_LABELS: Partial<Record<PlayerState, string>> = {
  preparing: 'Preparing lesson…',
  polling: 'Generating video…',
  ready: 'Ready to play',
  playing: 'Playing',
  paused: 'Paused',
  question: 'Question — your turn',
  error: 'Generation failed',
}

// ─── Component ────────────────────────────────────────────────────────────────

export function LessonVideoPlayer({
  lesson,
  language,
  onQuestionReached,
  onVideoEnd,
  onBeforeGenerate,
  className,
}: LessonVideoPlayerProps) {
  const [playerState, setPlayerState] = useState<PlayerState>('idle')
  const [job, setJob] = useState<VideoJob | null>(null)
  const [error, setError] = useState<string>('')
  const [currentClipIndex, setCurrentClipIndex] = useState(0)

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pollDeadlineRef = useRef<number>(0)
  const abortRef = useRef<AbortController | null>(null)

  // ─── Cleanup ────────────────────────────────────────────────────────────────
  const stopPolling = useCallback(() => {
    if (pollTimerRef.current !== null) {
      clearTimeout(pollTimerRef.current)
      pollTimerRef.current = null
    }
  }, [])

  useEffect(() => {
    return () => {
      stopPolling()
      abortRef.current?.abort()
    }
  }, [stopPolling])

  // ─── Polling loop ────────────────────────────────────────────────────────────
  const poll = useCallback(
    async (currentJob: VideoJob) => {
      // If all clips are done, no need to poll further.
      if (currentJob.state === 'ready' || currentJob.state === 'error') return

      try {
        const res = await fetch('/api/teacher/video-status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ job: currentJob }),
        })

        if (!res.ok) {
          const data = (await res.json()) as { error?: string }
          setError(data?.error ?? `Status check failed (${res.status}).`)
          setPlayerState('error')
          return
        }

        const data = (await res.json()) as { job: VideoJob }
        const updatedJob = data.job

        setJob(updatedJob)

        if (updatedJob.state === 'ready') {
          setPlayerState('ready')
        } else if (updatedJob.state === 'error') {
          setError(updatedJob.error ?? 'Video generation failed.')
          setPlayerState('error')
        } else if (Date.now() >= pollDeadlineRef.current) {
          // Out of patience. Whatever rendered is still worth watching.
          const rendered = updatedJob.clips.filter(
            (c) => c.clipStatus === 'done' && c.videoUrl,
          ).length
          if (rendered > 0) {
            setPlayerState('ready')
          } else {
            setError('Video generation timed out — D-ID never finished rendering.')
            setPlayerState('error')
          }
        } else {
          // Still rendering — poll again after delay.
          pollTimerRef.current = setTimeout(() => {
            void poll(updatedJob)
          }, POLL_INTERVAL_MS)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Polling error.')
        setPlayerState('error')
      }
    },
    [],
  )

  // ─── Start generation ────────────────────────────────────────────────────────
  const startGeneration = useCallback(async () => {
    onBeforeGenerate?.()
    setError('')
    setJob(null)
    setCurrentClipIndex(0)
    setPlayerState('preparing')
    pollDeadlineRef.current = Date.now() + POLL_TIMEOUT_MS

    abortRef.current = new AbortController()

    try {
      const res = await fetch('/api/teacher/generate-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lessonId: lesson.id,
          language,
          lesson,
        }),
        signal: abortRef.current.signal,
      })

      const data = (await res.json()) as { job?: VideoJob; error?: string }

      if (!res.ok || !data.job) {
        setError(data.error ?? `Generation failed (${res.status}).`)
        setPlayerState('error')
        return
      }

      setJob(data.job)
      setPlayerState('polling')

      // Start polling immediately — D-ID processes clips quickly.
      void poll(data.job)
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      setError(err instanceof Error ? err.message : 'Could not start generation.')
      setPlayerState('error')
    }
  }, [lesson, language, onBeforeGenerate, poll])

  // ─── Playback: advance to next clip ─────────────────────────────────────────
  const playClipAt = useCallback(
    (index: number) => {
      if (!job) return
      const readyClips = job.clips.filter((c) => c.clipStatus === 'done' && c.videoUrl)
      const clip = readyClips[index]
      if (!clip) {
        // No more clips — lesson complete.
        onVideoEnd?.()
        return
      }

      setCurrentClipIndex(index)

      if (videoRef.current) {
        videoRef.current.src = clip.videoUrl!
        void videoRef.current.play().catch(() => {
          // Autoplay may be blocked; switch to paused so user can click play.
          setPlayerState('paused')
        })
      }

      setPlayerState('playing')
    },
    [job, onVideoEnd],
  )

  // ─── Video element callbacks ─────────────────────────────────────────────────
  const handleVideoEnded = useCallback(() => {
    if (!job) return
    const readyClips = job.clips.filter((c) => c.clipStatus === 'done' && c.videoUrl)
    const currentClip = readyClips[currentClipIndex]

    if (currentClip?.pauseForInteraction) {
      // Pause and notify the classroom.
      setPlayerState('question')
      onQuestionReached?.(currentClip.questionIndex ?? 0)
      return
    }

    // Advance to next clip.
    const nextIndex = currentClipIndex + 1
    if (nextIndex < readyClips.length) {
      playClipAt(nextIndex)
    } else {
      onVideoEnd?.()
    }
  }, [job, currentClipIndex, onQuestionReached, onVideoEnd, playClipAt])

  // ─── Auto-start playback when ready ──────────────────────────────────────────
  useEffect(() => {
    if (playerState === 'ready' && job) {
      playClipAt(0)
    }
  }, [playerState, job, playClipAt])

  // ─── Controls ────────────────────────────────────────────────────────────────
  const handlePlay = () => {
    videoRef.current?.play()
    setPlayerState('playing')
  }

  const handlePause = () => {
    videoRef.current?.pause()
    setPlayerState('paused')
  }

  const handleResume = () => {
    videoRef.current?.play()
    setPlayerState('playing')
  }

  const handleStop = () => {
    stopPolling()
    abortRef.current?.abort()
    if (videoRef.current) {
      videoRef.current.pause()
      videoRef.current.src = ''
    }
    setPlayerState('idle')
    setJob(null)
    setCurrentClipIndex(0)
  }

  const handleReplay = () => {
    setCurrentClipIndex(0)
    playClipAt(0)
  }

  const handleContinueAfterQuestion = () => {
    if (!job) return
    const readyClips = job.clips.filter((c) => c.clipStatus === 'done' && c.videoUrl)
    const nextIndex = currentClipIndex + 1
    if (nextIndex < readyClips.length) {
      playClipAt(nextIndex)
    } else {
      onVideoEnd?.()
    }
  }

  /**
   * Skips to the next scene.
   *
   * A scene runs for as long as its narration does, with no way to move on —
   * so re-watching one part meant sitting through everything before it. This
   * ends the lesson when there is nothing left, the same as playing to the end.
   */
  const handleSkipNext = () => {
    if (!job) return
    const clips = job.clips.filter((c) => c.clipStatus === 'done' && c.videoUrl)
    const nextIndex = currentClipIndex + 1
    if (nextIndex < clips.length) {
      playClipAt(nextIndex)
    } else {
      onVideoEnd?.()
    }
  }

  // ─── Derived display info ─────────────────────────────────────────────────────
  const readyClips = job?.clips.filter((c) => c.clipStatus === 'done' && c.videoUrl) ?? []
  const currentClipData: VideoClip | undefined = readyClips[currentClipIndex]
  const totalClips = job?.clips.length ?? 0
  const doneClips = job?.clips.filter((c) => c.clipStatus === 'done').length ?? 0
  const overallProgress = job?.progress ?? 0

  // ─── Render ────────────────────────────────────────────────────────────────

  // Idle state — just the generate button
  if (playerState === 'idle') {
    return (
      <div className={cn('flex flex-col gap-2', className)}>
        <Button
          className="w-full gap-2 bg-gradient-to-r from-violet-500 to-purple-600 text-white hover:from-violet-600 hover:to-purple-700"
          onClick={() => void startGeneration()}
        >
          <Film className="size-4" />
          Generate AI Teaching Video
        </Button>
        <p className="text-[11px] leading-relaxed text-slate-500">
          Creates a photorealistic AI teacher video with natural speech and educational visuals.
          Generation takes ~1–2 minutes.
        </p>
      </div>
    )
  }

  // Preparing / polling — show progress
  if (playerState === 'preparing' || playerState === 'polling') {
    return (
      <div className={cn('flex flex-col gap-2 rounded-2xl border border-violet-400/20 bg-violet-500/5 p-3', className)}>
        <div className="flex items-center gap-2 text-sm text-violet-100">
          <Loader2 className="size-3.5 animate-spin text-violet-300" />
          <span>{playerState === 'preparing' ? 'Preparing lesson…' : 'Generating video…'}</span>
        </div>

        {job && (
          <>
            <p className="text-xs text-slate-400">{job.statusMessage}</p>
            <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full rounded-full bg-gradient-to-r from-violet-400 to-purple-500 transition-[width] duration-500"
                style={{ width: `${overallProgress}%` }}
              />
            </div>
            <p className="text-[11px] text-slate-500">
              {doneClips}/{totalClips} scenes ready
            </p>
          </>
        )}

        {!job && (
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
            <div className="h-full w-1/4 animate-pulse rounded-full bg-gradient-to-r from-violet-400 to-purple-500" />
          </div>
        )}

        <button
          type="button"
          onClick={handleStop}
          className="mt-1 flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-violet-400/20 bg-violet-500/10 text-xs font-medium text-violet-200 transition-colors hover:bg-violet-500/20"
        >
          <X className="size-3.5" />
          Cancel
        </button>
      </div>
    )
  }

  // Error state
  if (playerState === 'error') {
    return (
      <div className={cn('flex flex-col gap-2 rounded-2xl border border-red-500/20 bg-red-500/5 p-3', className)}>
        <div className="flex items-center gap-2 text-sm text-red-200">
          <AlertTriangle className="size-3.5" />
          Video generation failed
        </div>
        <p className="text-xs text-red-200/70">{error}</p>
        <Button
          size="sm"
          className="mt-1 w-full gap-2 bg-gradient-to-r from-violet-500 to-purple-600 text-white"
          onClick={() => void startGeneration()}
        >
          <RefreshCw className="size-3.5" />
          Retry
        </Button>
      </div>
    )
  }

  // Video player states (playing, paused, question)
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {/* Video element */}
      <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-black">
        <video
          ref={videoRef}
          className="w-full"
          playsInline
          onEnded={handleVideoEnded}
          onError={() => {
            // Try next clip if current fails.
            const next = currentClipIndex + 1
            if (next < readyClips.length) {
              playClipAt(next)
            }
          }}
        />

        {/* State overlays */}
        {playerState === 'question' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-950/80 p-4 text-center backdrop-blur-sm">
            <div className="rounded-full border border-cyan-400/30 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium uppercase tracking-wide text-cyan-200">
              Your turn to answer
            </div>
            <p className="text-xs text-slate-300">
              Answer the question below, then continue the video.
            </p>
          </div>
        )}

        {/* Scene indicator */}
        {(playerState === 'playing' || playerState === 'paused') && currentClipData && (
          <div className="absolute left-2 top-2 flex items-center gap-1.5 rounded-full border border-white/10 bg-slate-900/70 px-2.5 py-1 text-[10px] uppercase tracking-wider text-slate-300 backdrop-blur-sm">
            <span className="relative flex size-1.5 rounded-full bg-violet-400" />
            {currentClipData.sceneType}
          </div>
        )}

        {/* Progress bar overlay */}
        {readyClips.length > 1 && (
          <div className="absolute inset-x-2 bottom-2 flex gap-1">
            {readyClips.map((_, i) => (
              <div
                key={i}
                className={cn(
                  'h-0.5 flex-1 rounded-full transition-all duration-300',
                  i < currentClipIndex
                    ? 'bg-violet-400'
                    : i === currentClipIndex
                      ? 'bg-white'
                      : 'bg-white/20',
                )}
              />
            ))}
          </div>
        )}
      </div>

      {/* Transport controls */}
      <div className="flex items-center gap-2">
        {playerState === 'playing' && (
          <Button
            size="icon"
            className="h-9 w-9 rounded-full border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10"
            aria-label="Pause video"
            onClick={handlePause}
          >
            <Pause className="size-4" />
          </Button>
        )}

        {playerState === 'paused' && (
          <Button
            size="icon"
            className="h-9 w-9 rounded-full bg-gradient-to-r from-violet-500 to-purple-600 text-white"
            aria-label="Play video"
            onClick={handleResume}
          >
            <Play className="ml-0.5 size-4" />
          </Button>
        )}

        {playerState === 'question' && (
          <Button
            size="sm"
            className="flex-1 gap-2 bg-gradient-to-r from-cyan-500 to-blue-500 text-white"
            onClick={handleContinueAfterQuestion}
          >
            Continue video
            <ChevronRight className="size-3.5" />
          </Button>
        )}

        {(playerState === 'playing' || playerState === 'paused') && (
          <Button
            size="icon"
            className="h-9 w-9 rounded-full border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10"
            aria-label="Replay from beginning"
            onClick={handleReplay}
            title="Replay from beginning"
          >
            <SkipBack className="size-4" />
          </Button>
        )}

        {(playerState === 'playing' || playerState === 'paused') && (
          <Button
            size="icon"
            className="h-9 w-9 rounded-full border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10"
            aria-label={
              currentClipIndex + 1 < readyClips.length ? 'Next scene' : 'Finish video'
            }
            onClick={handleSkipNext}
            title={currentClipIndex + 1 < readyClips.length ? 'Next scene' : 'Finish'}
          >
            <SkipForward className="size-4" />
          </Button>
        )}

        {/* Scene counter, so skipping has somewhere to aim. */}
        {(playerState === 'playing' || playerState === 'paused') && readyClips.length > 0 && (
          <span className="ml-auto text-[11px] tabular-nums text-slate-500">
            Scene {currentClipIndex + 1} of {readyClips.length}
          </span>
        )}

        {playerState !== 'question' && (
          <Button
            size="icon"
            className="h-9 w-9 rounded-full border border-red-500/20 bg-red-500/5 text-red-300 hover:bg-red-500/10"
            aria-label="Stop video and return to idle"
            onClick={handleStop}
            title="Stop"
          >
            <X className="size-3.5" />
          </Button>
        )}
      </div>

      {/* Info row */}
      <div className="flex items-center justify-between text-[11px] text-slate-500">
        <span>
          {STATE_LABELS[playerState] ?? playerState} ·{' '}
          {currentClipIndex + 1}/{Math.max(readyClips.length, 1)}
        </span>
        {currentClipData?.sceneType === 'question' && (
          <span className="text-cyan-400/80">Checkpoint</span>
        )}
      </div>
    </div>
  )
}
