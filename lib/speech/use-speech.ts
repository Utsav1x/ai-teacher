'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { wordToVisemes, visemeHoldMs, type Viseme } from './visemes'

/**
 * Narration via the Web Speech API.
 *
 * Chosen over a hosted TTS service deliberately: it needs no API key, has no
 * quota to exhaust mid-demo, works offline, and speaks whatever language the
 * lesson was generated in. The trade-off is that voice quality depends on the
 * viewer's OS.
 *
 * Also drives avatar lip-sync — `viseme` updates in time with the real
 * utterance, because word boundaries come from the synthesiser itself.
 */

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
  /** True while speech is paused mid-utterance. */
  paused: boolean
  /** Current mouth shape for the avatar. */
  viseme: Viseme
  /** False when the browser has no speech synthesis at all. */
  supported: boolean
  /** True when no voice matches the lesson language — narration falls back. */
  languageUnavailable: boolean
  /** The resolved voice, so other features (video export) can match it. */
  voice: SpeechSynthesisVoice | null
  speak: (text: string) => void
  pause: () => void
  resume: () => void
  stop: () => void
}

export function useSpeech(language: string): UseSpeechResult {
  const [speaking, setSpeaking] = useState(false)
  const [paused, setPaused] = useState(false)
  const [viseme, setViseme] = useState<Viseme>('rest')
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [supported, setSupported] = useState(true)

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

  // ── Voice list ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      setSupported(false)
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

  const languageUnavailable = voices.length > 0 && !voice && tag !== 'en'

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

  /** Plays one word's mouth shapes across roughly the time it takes to say it. */
  const animateWord = useCallback(
    (word: string) => {
      clearTimers()
      const shapes = wordToVisemes(word)
      const hold = visemeHoldMs(word, shapes.length)

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
   * `onboundary` is optional in the spec and many voices — most non-English
   * ones — never fire it, which would leave the mouth motionless for the whole
   * lesson. This drives the animation from an estimate instead, and is
   * cancelled the moment a real boundary event proves the voice supports them.
   */
  const startFallbackAnimation = useCallback(
    (text: string) => {
      const words = text.split(/\s+/).filter(Boolean)
      fallbackWordsRef.current = words

      const step = () => {
        if (boundarySeenRef.current) return
        const index = fallbackIndexRef.current
        if (index >= words.length) return

        const word = words[index]!
        fallbackIndexRef.current = index + 1
        animateWord(word)
        // ~165 wpm at rate 0.95, scaled by word length.
        const duration = Math.min(950, Math.max(230, word.length * 78))
        fallbackRef.current = window.setTimeout(step, duration)
      }

      step()
    },
    [animateWord],
  )

  // ── Controls ────────────────────────────────────────────────────────────────
  const stop = useCallback(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
    window.speechSynthesis.cancel()
    clearTimers()
    clearFallback()
    clearKeepAlive()
    utteranceRef.current = null
    setSpeaking(false)
    setPaused(false)
    setViseme('rest')
  }, [clearTimers, clearFallback, clearKeepAlive])

  const speak = useCallback(
    (text: string) => {
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
      const trimmed = text?.trim()
      if (!trimmed) return

      window.speechSynthesis.cancel()
      clearTimers()
      clearFallback()
      clearKeepAlive()
      boundarySeenRef.current = false
      fallbackIndexRef.current = 0

      const utterance = new SpeechSynthesisUtterance(trimmed)
      if (voice) utterance.voice = voice
      utterance.lang = voice?.lang ?? tag
      utterance.rate = 0.95 // Slightly under default — this is teaching, not reading.
      utterance.pitch = 1.05

      utterance.onstart = () => {
        setSpeaking(true)
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
        setPaused(false)
        setViseme('rest')
        utteranceRef.current = null
      }

      utterance.onend = finish
      utterance.onerror = finish

      utteranceRef.current = utterance
      window.speechSynthesis.speak(utterance)
    },
    [animateWord, clearTimers, clearFallback, clearKeepAlive, startFallbackAnimation, tag, voice],
  )

  const pause = useCallback(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
    window.speechSynthesis.pause()
    clearTimers()
    clearFallback()
    setPaused(true)
    setViseme('rest')
  }, [clearTimers, clearFallback])

  const resume = useCallback(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
    window.speechSynthesis.resume()
    setPaused(false)

    // Boundary-driven mouths restart themselves on the next event; the
    // estimated walk has to be picked back up from where it stopped.
    if (!boundarySeenRef.current && fallbackWordsRef.current.length > 0) {
      startFallbackAnimation(fallbackWordsRef.current.join(' '))
    }
  }, [startFallbackAnimation])

  // Leaving the classroom mid-sentence should not keep talking.
  useEffect(() => stop, [stop])

  return {
    speaking,
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
