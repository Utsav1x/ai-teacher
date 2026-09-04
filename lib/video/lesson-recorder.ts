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
  /** Browser voice, used only when narration falls back to speechSynthesis. */
  voice: SpeechSynthesisVoice | null
  /**
   * 'generated' — fetch real audio from /api/teacher/speak and mix it into the
   *   file directly. No permission prompt, and exact lip-sync because each
   *   clip's duration is known up front.
   * 'tab'    — capture tab audio via getDisplayMedia (prompts to share).
   * 'silent' — no audio; captions carry the lesson.
   */
  audioMode: 'generated' | 'tab' | 'silent'
  onProgress?: (fraction: number, label: string) => void
  signal?: AbortSignal
}

export interface RecordResult {
  blob: Blob
  hasAudio: boolean
  durationMs: number
  /**
   * True if the tab was hidden at any point. Browsers throttle timers in
   * background tabs, so the video will be complete but choppy — worth telling
   * the user rather than letting them wonder why it stutters.
   */
  wasBackgrounded: boolean
}

/**
 * Splits narration into caption-sized pieces at sentence boundaries, grouping
 * short sentences together.
 *
 * Each caption costs one TTS request, and the free tier allows only a couple of
 * dozen a day — so one request per sentence burns a whole day's quota on a
 * single video. Grouping to roughly this many characters cuts that severalfold
 * while keeping captions short enough to read comfortably on screen.
 */
const CAPTION_TARGET_CHARS = 260

function toCaptions(text: string): string[] {
  const sentences = text
    .split(/(?<=[.!?।])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)

  if (sentences.length === 0) return [text]

  const captions: string[] = []
  let current = ''

  for (const sentence of sentences) {
    if (!current) {
      current = sentence
    } else if (current.length + sentence.length + 1 <= CAPTION_TARGET_CHARS) {
      current = `${current} ${sentence}`
    } else {
      captions.push(current)
      current = sentence
    }
  }
  if (current) captions.push(current)

  return captions
}

/**
 * Prefers MP4 (H.264/AAC) because it plays anywhere — PowerPoint, phones,
 * QuickTime, video editors — whereas WebM does not. Chrome only gained MP4
 * recording recently, so WebM remains the fallback.
 */
function pickMimeType(): string {
  const candidates = [
    // Deliberately does NOT request mp4a.40.2 (AAC). Chrome reports AAC as
    // supported via isTypeSupported and then throws
    // "EncodingError: The given encoder configuration is not supported"
    // at record time whenever an audio track is attached, producing a 0-byte
    // file. Leaving the audio codec unspecified lets Chrome negotiate one it
    // can actually encode (currently Opus), and video-only recording is
    // unaffected either way.
    'video/mp4;codecs=avc1.42E01E',
    'video/mp4;codecs=avc1',
    'video/mp4',
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

/** File extension matching whatever container the recorder actually produced. */
export function extensionForMimeType(mimeType: string): string {
  return mimeType.includes('mp4') ? 'mp4' : mimeType.includes('matroska') ? 'mkv' : 'webm'
}

/**
 * How long a caption should stay on screen when there is no audio to pace it.
 *
 * Without this the recorder races through every caption in milliseconds and
 * produces a video a fraction of a second long — technically valid, but with
 * nothing in it.
 */
function readingTimeMs(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length
  return Math.min(14000, Math.max(2200, words * 380))
}

export async function recordLessonVideo(options: RecordOptions): Promise<RecordResult> {
  const { lessonTitle, language, segments, voice, audioMode, onProgress, signal } = options

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

  const started = performance.now()

  /**
   * Painted on an interval rather than requestAnimationFrame.
   *
   * rAF is suspended entirely while the tab is not visible, so if the user
   * looks away mid-recording the canvas stops updating and the captured stream
   * simply stops receiving frames — producing a one-second video of a
   * thirty-second lesson. Timers are throttled in background tabs but never
   * stopped, so the recording stays complete either way.
   */
  const paintId = window.setInterval(() => {
    drawFrame(ctx, frame, performance.now() - started)
  }, 1000 / 30)

  // One immediate frame so the stream never starts empty.
  drawFrame(ctx, frame, 0)

  let wasBackgrounded = document.visibilityState === 'hidden'
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') wasBackgrounded = true
  }
  document.addEventListener('visibilitychange', onVisibility)

  // ── Streams ─────────────────────────────────────────────────────────────────
  const stream = canvas.captureStream(30)
  let audioStream: MediaStream | null = null
  let hasAudio = false

  // Generated narration is routed through Web Audio so it reaches both the
  // recording and the speakers.
  let audioCtx: AudioContext | null = null
  let mixDestination: MediaStreamAudioDestinationNode | null = null
  /** First clip, fetched before recording starts — see the comment below. */
  let primedClip: AudioBuffer | null = null

  /**
   * Audio is proven before the track is attached, never after.
   *
   * A MediaStream audio track that carries no samples stalls the muxer: video
   * frames stop being written within a second, producing a complete-looking
   * file containing almost nothing. So we fetch the first clip up front, and
   * only attach an audio track if that actually succeeded. If narration is
   * unavailable — a spent TTS quota, no network — the recording is video-only,
   * which records correctly.
   */
  if (audioMode === 'generated') {
    const firstCaption = toCaptions(segments[0]!.narration)[0]

    if (firstCaption) {
      try {
        const res = await fetch('/api/teacher/speak', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: firstCaption, language }),
        })

        if (res.ok) {
          const Ctor =
            window.AudioContext ??
            (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext

          if (Ctor) {
            const ctxCandidate = new Ctor()
            if (ctxCandidate.state === 'suspended') await ctxCandidate.resume()

            primedClip = await ctxCandidate.decodeAudioData(await res.arrayBuffer())

            const dest = ctxCandidate.createMediaStreamDestination()
            const [track] = dest.stream.getAudioTracks()

            if (track && ctxCandidate.state === 'running') {
              stream.addTrack(track)
              audioCtx = ctxCandidate
              mixDestination = dest
            } else {
              await ctxCandidate.close().catch(() => {})
              primedClip = null
            }
          }
        }
      } catch {
        primedClip = null
      }
    }

    if (!audioCtx) {
      console.warn('[recorder] Narration unavailable — recording video only.')
    }
  }

  if (audioMode === 'tab' && navigator.mediaDevices?.getDisplayMedia) {
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

  // Chrome can accept a mime type and then fail to encode it. Capture that so
  // the user gets the real reason instead of an empty file and no explanation.
  let recorderError = ''
  recorder.onerror = (event) => {
    const err = (event as unknown as { error?: DOMException }).error
    recorderError = err ? `${err.name}: ${err.message}` : 'Recording failed.'
    console.error('[recorder]', recorderError)
  }

  const finished = new Promise<Blob>((resolve) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType }))
  })

  const cleanup = () => {
    window.clearInterval(paintId)
    document.removeEventListener('visibilitychange', onVisibility)
    window.speechSynthesis.cancel()
    for (const track of stream.getTracks()) track.stop()
    if (audioStream) for (const track of audioStream.getTracks()) track.stop()
    void audioCtx?.close().catch(() => {})
  }

  recorder.start(250)

  // ── Narration timeline ──────────────────────────────────────────────────────
  const totalCaptions = segments.reduce((n, s) => n + toCaptions(s.narration).length, 0)
  let done = 0
  /** Cleared after the first TTS failure so we stop retrying a spent quota. */
  let ttsAvailable = audioCtx !== null

  /**
   * Animates the mouth for `ms` with no audio driving it. Used when narration
   * is unavailable, so the caption still gets its time on screen and the
   * avatar still looks like it is talking.
   */
  const animateSilently = (text: string, ms: number) =>
    new Promise<void>((resolve) => {
      const words = text.split(/\s+/).filter(Boolean)
      const timers: number[] = []
      const totalWeight = words.reduce((sum, w) => sum + Math.max(2, w.length), 0) || 1
      let elapsed = 0

      frame.speaking = true

      for (const word of words) {
        const share = (Math.max(2, word.length) / totalWeight) * ms
        const shapes = wordToVisemes(word)
        const hold = share / Math.max(1, shapes.length)
        shapes.forEach((shape: Viseme, i) => {
          timers.push(window.setTimeout(() => (frame.viseme = shape), elapsed + i * hold))
        })
        elapsed += share
      }

      window.setTimeout(() => {
        for (const id of timers) window.clearTimeout(id)
        frame.viseme = 'rest'
        frame.speaking = false
        resolve()
      }, ms)
    })

  /**
   * Plays generated audio, driving the mouth across its *known* duration —
   * so lip-sync here is exact rather than estimated. Resolves when the clip
   * finishes. Returns false if audio could not be produced, so the caller can
   * fall back to the browser synthesiser.
   */
  const playGeneratedCaption = async (text: string): Promise<boolean> => {
    if (!audioCtx || !mixDestination || !ttsAvailable) return false

    let buffer: AudioBuffer

    // The first caption was already fetched to prove audio works — reuse it
    // rather than spending a second TTS request on the same text.
    if (primedClip) {
      buffer = primedClip
      primedClip = null
    } else {
      try {
        const res = await fetch('/api/teacher/speak', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, language }),
        })

        if (!res.ok) {
          // Stop asking rather than making a doomed round-trip per caption.
          ttsAvailable = false
          console.warn('[recorder] Narration ran out mid-recording.')
          return false
        }

        buffer = await audioCtx.decodeAudioData(await res.arrayBuffer())
      } catch {
        ttsAvailable = false
        return false
      }
    }

    const source = audioCtx.createBufferSource()
    source.buffer = buffer
    source.connect(mixDestination) // into the recording
    source.connect(audioCtx.destination) // and out of the speakers

    const words = text.split(/\s+/).filter(Boolean)
    const timers: number[] = []

    // Spread the words across the clip's real length, weighted by word length
    // so longer words hold their shapes longer.
    const totalWeight = words.reduce((sum, w) => sum + Math.max(2, w.length), 0)
    let elapsed = 0

    for (const word of words) {
      const share = (Math.max(2, word.length) / totalWeight) * buffer.duration * 1000
      const shapes = wordToVisemes(word)
      const hold = share / Math.max(1, shapes.length)

      shapes.forEach((shape: Viseme, i) => {
        timers.push(window.setTimeout(() => (frame.viseme = shape), elapsed + i * hold))
      })
      elapsed += share
    }

    frame.speaking = true
    hasAudio = true
    source.start()

    await new Promise<void>((resolve) => {
      source.onended = () => resolve()
      // decodeAudioData gives us the exact length; this is just a safety net.
      window.setTimeout(resolve, buffer.duration * 1000 + 500)
    })

    for (const id of timers) window.clearTimeout(id)
    frame.viseme = 'rest'
    frame.speaking = false
    return true
  }

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

        const floor = readingTimeMs(caption)
        const startedAt = performance.now()

        const played = await playGeneratedCaption(caption)
        if (!played) await speakCaption(caption)

        // Whatever narration did or did not happen, the caption has to stay on
        // screen long enough to be read. Without this floor a failed TTS call
        // produces a video with no watchable content in it.
        const remaining = floor - (performance.now() - startedAt)
        if (remaining > 250) await animateSilently(caption, remaining)

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

  if (recorderError) {
    throw new Error(`The browser could not encode the video (${recorderError}).`)
  }
  if (blob.size === 0) {
    throw new Error(
      'The recording came out empty. This usually means the browser rejected the ' +
        'video or audio codec combination.',
    )
  }

  return { blob, hasAudio, durationMs: performance.now() - started, wasBackgrounded }
}
