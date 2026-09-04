/**
 * Renders a lesson to a downloadable video file.
 *
 * The recorder drives its own narration rather than reusing the classroom's
 * speech hook, so it can await each segment's `onend` and keep captions,
 * mouth shapes and slides in exact lockstep with the audio.
 *
 * Audio caveat: `speechSynthesis` writes straight to the output device and
 * cannot be routed into a MediaStream, so canvas capture alone produces a
 * silent file. When the browser can supply tab audio (`getDisplayMedia`) we mix
 * that in; otherwise the video ships silent, which is why captions are burned
 * into every frame rather than being optional.
 */

import { drawFrame, VIDEO_WIDTH, VIDEO_HEIGHT, type FrameState } from './draw-frame'
import { wordToVisemes, visemeHoldMs, type Viseme } from '@/lib/speech/visemes'

export interface LessonVideoSegment {
  kind: string
  heading: string
  /** Spoken and captioned. */
  narration: string
  keyPoints?: string[]
  visual?: string
}

export interface RecordOptions {
  lessonTitle: string
  language: string
  segments: LessonVideoSegment[]
  voice: SpeechSynthesisVoice | null
  /** Try to capture tab audio so narration lands in the file. */
  withAudio: boolean
  onProgress?: (fraction: number, label: string) => void
  signal?: AbortSignal
}

export interface RecordResult {
  blob: Blob
  hasAudio: boolean
  durationMs: number
}

/** Splits narration into caption-sized pieces at sentence boundaries. */
function toCaptions(text: string): string[] {
  const parts = text
    .split(/(?<=[.!?।])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
  return parts.length > 0 ? parts : [text]
}

function pickMimeType(): string {
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp9',
    'video/webm',
  ]
  for (const type of candidates) {
    if (MediaRecorder.isTypeSupported(type)) return type
  }
  return 'video/webm'
}

export async function recordLessonVideo(options: RecordOptions): Promise<RecordResult> {
  const { lessonTitle, language, segments, voice, withAudio, onProgress, signal } = options

  if (typeof window === 'undefined') throw new Error('Recording requires a browser.')
  if (!('MediaRecorder' in window)) {
    throw new Error('This browser cannot record video (MediaRecorder is unavailable).')
  }
  if (segments.length === 0) throw new Error('There is nothing to record yet.')

  const canvas = document.createElement('canvas')
  canvas.width = VIDEO_WIDTH
  canvas.height = VIDEO_HEIGHT
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not create a drawing context.')

  // ── Live frame state ────────────────────────────────────────────────────────
  const frame: FrameState = {
    lessonTitle,
    heading: segments[0]!.heading,
    kind: segments[0]!.kind,
    caption: '',
    keyPoints: segments[0]!.keyPoints ?? [],
    visual: segments[0]!.visual,
    viseme: 'rest',
    speaking: false,
    progress: 0,
    language,
  }

  let rafId = 0
  const started = performance.now()
  const paint = () => {
    drawFrame(ctx, frame, performance.now() - started)
    rafId = requestAnimationFrame(paint)
  }
  paint()

  // ── Streams ─────────────────────────────────────────────────────────────────
  const stream = canvas.captureStream(30)
  let audioStream: MediaStream | null = null
  let hasAudio = false

  if (withAudio && navigator.mediaDevices?.getDisplayMedia) {
    try {
      audioStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      })
      const [track] = audioStream.getAudioTracks()
      if (track) {
        stream.addTrack(track)
        hasAudio = true
      }
      // The video track of the screen share is only a side effect of asking
      // for audio — the picture comes from our canvas.
      for (const v of audioStream.getVideoTracks()) v.stop()
    } catch {
      // User declined, or did not tick "share audio". Continue silently.
    }
  }

  const chunks: BlobPart[] = []
  const recorder = new MediaRecorder(stream, {
    mimeType: pickMimeType(),
    videoBitsPerSecond: 2_500_000,
  })
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data)
  }

  const finished = new Promise<Blob>((resolve) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType }))
  })

  const cleanup = () => {
    cancelAnimationFrame(rafId)
    window.speechSynthesis.cancel()
    for (const track of stream.getTracks()) track.stop()
    if (audioStream) for (const track of audioStream.getTracks()) track.stop()
  }

  recorder.start(250)

  // ── Narration timeline ──────────────────────────────────────────────────────
  const totalCaptions = segments.reduce((n, s) => n + toCaptions(s.narration).length, 0)
  let done = 0

  /** Speaks one caption, animating the mouth, resolving when it finishes. */
  const speakCaption = (text: string) =>
    new Promise<void>((resolve) => {
      const utterance = new SpeechSynthesisUtterance(text)
      if (voice) utterance.voice = voice
      utterance.lang = voice?.lang ?? 'en'
      utterance.rate = 0.95
      utterance.pitch = 1.05

      const shapeTimers: number[] = []
      let wordTimer: number | null = null

      const stopAnimation = () => {
        for (const id of shapeTimers) window.clearTimeout(id)
        shapeTimers.length = 0
        if (wordTimer !== null) window.clearTimeout(wordTimer)
        wordTimer = null
      }

      // Estimated walk — boundary events are unreliable across voices, and a
      // recording cannot afford a motionless mouth.
      const words = text.split(/\s+/).filter(Boolean)
      let index = 0
      const stepWord = () => {
        if (index >= words.length) return
        const word = words[index++]!
        const shapes = wordToVisemes(word)
        const hold = visemeHoldMs(word, shapes.length)
        shapes.forEach((shape: Viseme, i) => {
          shapeTimers.push(window.setTimeout(() => (frame.viseme = shape), i * hold))
        })
        shapeTimers.push(
          window.setTimeout(() => (frame.viseme = 'rest'), shapes.length * hold),
        )
        wordTimer = window.setTimeout(stepWord, Math.min(950, Math.max(230, word.length * 78)))
      }

      const finish = () => {
        stopAnimation()
        frame.viseme = 'rest'
        frame.speaking = false
        resolve()
      }

      utterance.onstart = () => {
        frame.speaking = true
        stepWord()
      }
      utterance.onend = finish
      utterance.onerror = finish

      window.speechSynthesis.speak(utterance)

      // Some platforms never fire onend for long strings; do not hang forever.
      window.setTimeout(finish, Math.max(6000, text.length * 110))
    })

  try {
    for (const segment of segments) {
      if (signal?.aborted) break

      frame.heading = segment.heading
      frame.kind = segment.kind
      frame.keyPoints = segment.keyPoints ?? []
      frame.visual = segment.visual

      for (const caption of toCaptions(segment.narration)) {
        if (signal?.aborted) break
        frame.caption = caption
        onProgress?.(done / totalCaptions, segment.heading)
        await speakCaption(caption)
        done++
        frame.progress = done / totalCaptions
      }
    }

    onProgress?.(1, 'Finishing')
    // Let the last frame land in the stream before cutting.
    await new Promise((r) => setTimeout(r, 400))
  } finally {
    recorder.stop()
  }

  const blob = await finished
  cleanup()

  return { blob, hasAudio, durationMs: performance.now() - started }
}
