'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { wordToVisemes, visemeHoldMs, type Viseme } from './visemes'

/**
 * Narration, server-first.
 *
 * Two engines, in order of preference:
 *
 *   1. `/api/teacher/speak` — Microsoft neural voices over Edge TTS, with a
 *      Gemini fallback behind it. No API key, no quota, and it carries voices
 *      for every language a lesson can be generated in.
 *   2. The browser's Web Speech API, for when the route is unreachable.
 *
 * This used to be browser-only, which quietly capped the product at whatever
 * voices the viewer's OS shipped with. A learner on Windows asking for a
 * Marathi lesson got a banner saying no voice was installed and an English
 * voice reading Devanagari aloud — while `mr-IN-AarohiNeural` was available
 * server-side the entire time.
 *
 * Both engines drive avatar lip-sync through the same estimated walk over the
 * words. `onboundary` is optional in the spec and most non-English voices never
 * fire it, so the estimate is what actually animates the mouth in nearly every
 * lesson; a real boundary event, where one arrives, takes over.
 */

/** Above this the route returns 400, so don't waste the round trip. */
const MAX_SERVER_CHARS = 3000

/** Lesson language names (from /start) → BCP-47 prefixes. */
const LANGUAGE_TAGS: Record<string, string> = {
  english: 'en',
  hindi: 'hi',
  hinglish: 'hi',
  spanish: 'es',
  french: 'fr',
  german: 'de',
  mandarin: 'zh',
  chinese: 'zh',
  bengali: 'bn',
  tamil: 'ta',
  telugu: 'te',
  marathi: 'mr',
  gujarati: 'gu',
  kannada: 'kn',
  malayalam: 'ml',
  punjabi: 'pa',
  urdu: 'ur',
  arabic: 'ar',
  japanese: 'ja',
  korean: 'ko',
  portuguese: 'pt',
  russian: 'ru',
}

export function languageToTag(language: string): string {
  return LANGUAGE_TAGS[language.trim().toLowerCase()] ?? 'en'
}

export interface UseSpeechResult {
  /** True while an utterance is being spoken. */
  speaking: boolean
  /**
   * True between asking for narration and it starting to play.
   *
   * `speaking` is already true here so the avatar stays alive, but controls
   * that need to know whether there is real audio yet can tell the difference.
   */
  preparing: boolean
  /** True while speech is paused mid-utterance. */
  paused: boolean
  /** Current mouth shape for the avatar. */
  viseme: Viseme
  /** False when the browser has no speech synthesis at all. */
  supported: boolean
  /**
   * True only when server narration has failed *and* the browser has no voice
   * for this language — i.e. the one case where narration really is degraded.
   */
  languageUnavailable: boolean
  /** The resolved browser voice, so the video export can match it. */
  voice: SpeechSynthesisVoice | null
  speak: (text: string) => void
  pause: () => void
  resume: () => void
  stop: () => void
}

export function useSpeech(language: string, rate = 0.95): UseSpeechResult {
  const [speaking, setSpeaking] = useState(false)
  const [paused, setPaused] = useState(false)
  const [viseme, setViseme] = useState<Viseme>('rest')
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [browserSupported, setBrowserSupported] = useState(true)
  /**
   * Set once the route has actually failed. Until then the browser's voice list
   * says nothing about what the learner will hear, so no warning is shown.
   */
  const [serverUnavailable, setServerUnavailable] = useState(false)

  /** Timers for the mouth shapes within a single word. */
  const timersRef = useRef<number[]>([])
  /** Timer advancing word-to-word when boundary events are unavailable. */
  const fallbackRef = useRef<number | null>(null)
  /** Set once a real boundary event arrives — disables the estimated fallback. */
  const boundarySeenRef = useRef(false)
  /** Position in the estimated walk, so pause/resume continues where it stopped. */
  const fallbackIndexRef = useRef(0)
  const fallbackWordsRef = useRef<string[]>([])
  /** Chrome silently stops long utterances; this ticker keeps them alive. */
  const keepAliveRef = useRef<number | null>(null)
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null)

  /** Server narration playback. */
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const objectUrlRef = useRef<string | null>(null)
  /** Which engine is speaking, so pause/resume/stop reach the right one. */
  const engineRef = useRef<'browser' | 'server'>('browser')
  /** Discards a fetch that resolves after a newer speak() or a stop(). */
  const requestIdRef = useRef(0)
  /**
   * Pause intent, readable from async code.
   *
   * Narration is fetched before it plays, and `paused` state is not visible
   * inside that pending closure. Without this, pausing while a paragraph was
   * still downloading did nothing and the teacher started talking the moment
   * it arrived.
   */
  const pausedRef = useRef(false)
  /** True between asking for narration and the audio actually starting. */
  const [preparing, setPreparing] = useState(false)

  // ── Voice list ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      setBrowserSupported(false)
      return
    }

    const load = () => setVoices(window.speechSynthesis.getVoices())
    load() // Chrome sometimes has them immediately, sometimes not.
    window.speechSynthesis.addEventListener('voiceschanged', load)
    return () => window.speechSynthesis.removeEventListener('voiceschanged', load)
  }, [])

  const tag = languageToTag(language)

  const voice =
    voices.find((v) => v.lang.toLowerCase().startsWith(tag) && v.localService) ??
    voices.find((v) => v.lang.toLowerCase().startsWith(tag)) ??
    null

  const languageUnavailable = serverUnavailable && voices.length > 0 && !voice && tag !== 'en'

  // Narration is available if either engine can carry it. A browser with no
  // speech synthesis at all is still fine while the route answers.
  const supported = browserSupported || !serverUnavailable

  // ── Timer bookkeeping ───────────────────────────────────────────────────────
  const clearTimers = useCallback(() => {
    for (const id of timersRef.current) window.clearTimeout(id)
    timersRef.current = []
  }, [])

  const clearFallback = useCallback(() => {
    if (fallbackRef.current !== null) {
      window.clearTimeout(fallbackRef.current)
      fallbackRef.current = null
    }
  }, [])

  const clearKeepAlive = useCallback(() => {
    if (keepAliveRef.current !== null) {
      window.clearInterval(keepAliveRef.current)
      keepAliveRef.current = null
    }
  }, [])

  /**
   * Plays one word's mouth shapes across roughly the time it takes to say it.
   *
   * `spanMs` overrides the character-count estimate when the real audio length
   * is known, which matters most in scripts where character count says little
   * about spoken duration.
   */
  const animateWord = useCallback(
    (word: string, spanMs?: number) => {
      clearTimers()
      const shapes = wordToVisemes(word)
      const hold = spanMs
        ? Math.max(40, spanMs / Math.max(1, shapes.length))
        : visemeHoldMs(word, shapes.length)

      shapes.forEach((shape, i) => {
        const id = window.setTimeout(() => setViseme(shape), i * hold)
        timersRef.current.push(id)
      })

      // Settle closed at the end so gaps between words are not held open.
      const closeId = window.setTimeout(() => setViseme('rest'), shapes.length * hold)
      timersRef.current.push(closeId)
    },
    [clearTimers],
  )

  /**
   * Walks the words on an estimated clock.
   *
   * The server engine gives no word-timing information at all, and most browser
   * voices never fire `onboundary` either, so this is the normal path rather
   * than the exception. A real boundary event cancels it when one shows up.
   */
  const startFallbackAnimation = useCallback(
    (text: string, totalMs?: number) => {
      const words = text.split(/\s+/).filter(Boolean)
      fallbackWordsRef.current = words

      // Measured over what is left to say, not the whole paragraph, so a walk
      // restarted by resume() is scaled against the audio that actually remains.
      const totalChars =
        words.slice(fallbackIndexRef.current).reduce((n, w) => n + w.length, 0) || 1
      // When the real audio length is known, spread the walk across it so the
      // mouth stops exactly when the voice does. The character estimate below
      // is tuned for English and under-runs badly on Devanagari and other
      // Indic scripts, where a four-character word can take as long to say as
      // an eight-letter English one — the walk finished early and the mouth
      // sat still for the rest of the paragraph.
      const perChar = totalMs && totalMs > 0 ? totalMs / totalChars : 0

      const step = () => {
        if (boundarySeenRef.current) return
        const index = fallbackIndexRef.current
        if (index >= words.length) return

        const word = words[index]!
        fallbackIndexRef.current = index + 1

        const span = perChar ? perChar * word.length : undefined
        animateWord(word, span)

        // ~165 wpm at rate 0.95, scaled by word length, when nothing better.
        const duration = span
          ? Math.max(120, span)
          : Math.min(950, Math.max(230, word.length * 78))
        fallbackRef.current = window.setTimeout(step, duration)
      }

      step()
    },
    [animateWord],
  )

  const releaseAudio = useCallback(() => {
    const audio = audioRef.current
    if (audio) {
      audio.onplay = null
      audio.onended = null
      audio.onerror = null
      audio.pause()
      audio.removeAttribute('src')
    }
    audioRef.current = null

    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current)
      objectUrlRef.current = null
    }
  }, [])

  // ── Controls ────────────────────────────────────────────────────────────────
  const stop = useCallback(() => {
    // Anything already in flight belongs to a lesson state we have left.
    requestIdRef.current += 1

    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel()
    }
    releaseAudio()
    clearTimers()
    clearFallback()
    clearKeepAlive()
    utteranceRef.current = null
    pausedRef.current = false
    setSpeaking(false)
    setPreparing(false)
    setPaused(false)
    setViseme('rest')
  }, [clearTimers, clearFallback, clearKeepAlive, releaseAudio])

  /** Web Speech API — the fallback when the route cannot be reached. */
  const speakInBrowser = useCallback(
    (trimmed: string) => {
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
        setSpeaking(false)
        setPreparing(false)
        return
      }

      window.speechSynthesis.cancel()
      clearTimers()
      clearFallback()
      clearKeepAlive()
      boundarySeenRef.current = false
      fallbackIndexRef.current = 0
      engineRef.current = 'browser'

      const utterance = new SpeechSynthesisUtterance(trimmed)
      if (voice) utterance.voice = voice
      utterance.lang = voice?.lang ?? tag
      utterance.rate = Math.max(0.6, Math.min(1.4, rate))
      utterance.pitch = 1.05

      utterance.onstart = () => {
        setSpeaking(true)
        setPreparing(false)
        setPaused(false)

        // Animate immediately on the estimated clock. If the voice does support
        // boundary events, the first one cancels this within a few hundred ms.
        startFallbackAnimation(trimmed)

        // Chrome stops speaking after roughly 15 seconds unless nudged, which
        // would cut a teaching paragraph off mid-sentence.
        keepAliveRef.current = window.setInterval(() => {
          if (!window.speechSynthesis.speaking) return
          if (window.speechSynthesis.paused) return
          window.speechSynthesis.pause()
          window.speechSynthesis.resume()
        }, 9000)
      }

      utterance.onboundary = (event) => {
        if (event.name && event.name !== 'word') return

        // A real boundary is more accurate than the estimate — switch to it.
        if (!boundarySeenRef.current) {
          boundarySeenRef.current = true
          clearFallback()
        }

        const rest = trimmed.slice(event.charIndex)
        const word = rest.split(/\s+/)[0] ?? ''
        if (word) animateWord(word)
      }

      const finish = () => {
        clearTimers()
        clearFallback()
        clearKeepAlive()
        setSpeaking(false)
        setPreparing(false)
        setPaused(false)
        setViseme('rest')
        utteranceRef.current = null
      }

      utterance.onend = finish
      utterance.onerror = finish

      utteranceRef.current = utterance
      window.speechSynthesis.speak(utterance)
    },
    [
      animateWord,
      clearTimers,
      clearFallback,
      clearKeepAlive,
      startFallbackAnimation,
      tag,
      voice,
      rate,
    ],
  )

  /** Plays narration returned by the route, and hands back on any failure. */
  const playServerAudio = useCallback(
    (url: string, trimmed: string) => {
      releaseAudio()
      objectUrlRef.current = url

      const audio = new Audio(url)
      audio.playbackRate = Math.max(0.6, Math.min(1.4, rate))
      audioRef.current = audio
      engineRef.current = 'server'

      // An audio element reports no word boundaries, so the estimated walk is
      // the only thing driving the mouth here.
      boundarySeenRef.current = false
      fallbackIndexRef.current = 0

      const finish = () => {
        clearTimers()
        clearFallback()
        setSpeaking(false)
        setPreparing(false)
        setPaused(false)
        setViseme('rest')
      }

      /**
       * Spreads the mouth animation across the clip's real length.
       *
       * `duration` is only known once metadata has loaded, which is normally
       * before playback starts but is not guaranteed.
       */
      const startWalk = () => {
        const seconds = audio.duration
        const totalMs =
          Number.isFinite(seconds) && seconds > 0
            ? (seconds * 1000) / audio.playbackRate
            : undefined
        startFallbackAnimation(trimmed, totalMs)
      }

      audio.onplay = () => {
        setSpeaking(true)
        setPreparing(false)
        setPaused(false)
        startWalk()
      }
      audio.onended = finish
      audio.onerror = () => {
        // A codec the browser will not decode. Say it some other way.
        finish()
        speakInBrowser(trimmed)
      }

      if (pausedRef.current) {
        // The learner paused while this was downloading. Hold it ready so
        // resume() picks up here instead of the audio starting behind their back.
        setPreparing(false)
        setSpeaking(true)
        setPaused(true)
        return
      }

      void audio.play().catch(() => {
        // Autoplay refused — the browser voice is subject to the same rule, but
        // it costs nothing to try.
        finish()
        speakInBrowser(trimmed)
      })
    },
    [rate, clearTimers, clearFallback, releaseAudio, startFallbackAnimation, speakInBrowser],
  )

  const speak = useCallback(
    (text: string) => {
      const trimmed = text?.trim()
      if (!trimmed) return

      stop()
      const requestId = ++requestIdRef.current

      if (trimmed.length > MAX_SERVER_CHARS) {
        speakInBrowser(trimmed)
        return
      }

      // Claim the engine before the await, so a pause() arriving during the
      // fetch reaches the right one instead of the engine used last time.
      engineRef.current = 'server'

      // The fetch takes a moment; a motionless teacher in that gap reads as a
      // bug, so the avatar goes live straight away and the mouth starts when
      // the audio does. `preparing` keeps that distinguishable from real
      // playback for anything that needs to tell them apart.
      setSpeaking(true)
      setPreparing(true)

      void (async () => {
        let url: string | null = null

        try {
          const res = await fetch('/api/teacher/speak', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: trimmed, language }),
          })

          if (res.ok) {
            const blob = await res.blob()
            if (blob.size > 0) url = URL.createObjectURL(blob)
          }
        } catch {
          // Offline, or the dev server restarted mid-lesson.
        }

        // A newer utterance started, or the learner left. Drop this one.
        if (requestId !== requestIdRef.current) {
          if (url) URL.revokeObjectURL(url)
          return
        }

        if (url) {
          setServerUnavailable(false)
          playServerAudio(url, trimmed)
        } else {
          setServerUnavailable(true)
          setPreparing(false)
          speakInBrowser(trimmed)
        }
      })()
    },
    [language, stop, playServerAudio, speakInBrowser],
  )

  const pause = useCallback(() => {
    // Recorded before touching either engine: narration still downloading has
    // no audio element to pause, and this is what stops it starting on arrival.
    pausedRef.current = true

    if (engineRef.current === 'server') {
      audioRef.current?.pause()
    } else if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.pause()
    }

    clearTimers()
    clearFallback()
    setPaused(true)
    setViseme('rest')
  }, [clearTimers, clearFallback])

  const resume = useCallback(() => {
    pausedRef.current = false

    const audio = audioRef.current
    if (engineRef.current === 'server') {
      if (!audio) return
      void audio.play().catch(() => {})
    } else if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.resume()
    }

    setPaused(false)

    // Boundary-driven mouths restart themselves on the next event; the
    // estimated walk has to be picked back up from where it stopped.
    if (!boundarySeenRef.current && fallbackWordsRef.current.length > 0) {
      const remainingMs =
        engineRef.current === 'server' && audio && Number.isFinite(audio.duration)
          ? ((audio.duration - audio.currentTime) * 1000) / audio.playbackRate
          : undefined
      startFallbackAnimation(fallbackWordsRef.current.join(' '), remainingMs)
    }
  }, [startFallbackAnimation])

  // Leaving the classroom mid-sentence should not keep talking.
  useEffect(() => stop, [stop])

  return {
    speaking,
    preparing,
    paused,
    viseme,
    supported,
    languageUnavailable,
    voice,
    speak,
    pause,
    resume,
    stop,
  }
}
