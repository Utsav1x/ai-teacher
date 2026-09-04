'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import type { Viseme } from '@/lib/speech/visemes'

/**
 * Maya — the AI teacher's face.
 *
 * Drawn as SVG rather than composited from a photo so the mouth is genuinely
 * driven by the live viseme stream from `useSpeech`, and so the avatar matches
 * the holographic look of the rest of the product.
 *
 * Everything animated here is tied to real state: the mouth follows speech, the
 * glow pulses only while speaking, and blinks are idle behaviour.
 */

/** Mouth outline path + inner darkness, per viseme. */
const MOUTH_SHAPES: Record<Viseme, { d: string; inner?: string }> = {
  rest: {
    d: 'M 82 132 Q 100 138 118 132',
  },
  closed: {
    d: 'M 80 132 Q 100 134 120 132',
  },
  wide: {
    d: 'M 76 130 Q 100 142 124 130 Q 100 136 76 130 Z',
    inner: 'M 82 132 Q 100 138 118 132 Q 100 134 82 132 Z',
  },
  open: {
    d: 'M 84 126 Q 100 154 116 126 Q 100 134 84 126 Z',
    inner: 'M 89 131 Q 100 146 111 131 Q 100 135 89 131 Z',
  },
  round: {
    d: 'M 90 130 Q 100 122 110 130 Q 110 146 100 148 Q 90 146 90 130 Z',
    inner: 'M 94 132 Q 100 128 106 132 Q 106 142 100 143 Q 94 142 94 132 Z',
  },
  teeth: {
    d: 'M 80 130 Q 100 128 120 130 Q 100 142 80 130 Z',
    inner: 'M 85 133 Q 100 136 115 133 Q 100 139 85 133 Z',
  },
}

export interface TeacherAvatarProps {
  /** Current mouth shape from useSpeech. */
  viseme: Viseme
  /** Drives the ambient glow and idle motion. */
  speaking: boolean
  /** Dims the avatar and stills the mouth. */
  paused?: boolean
  /** Shown under the name — e.g. the current teaching phase. */
  status?: string
  className?: string
}

export function TeacherAvatar({
  viseme,
  speaking,
  paused = false,
  status,
  className,
}: TeacherAvatarProps) {
  const [blinking, setBlinking] = useState(false)

  // Idle blink — irregular, so it reads as alive rather than mechanical.
  useEffect(() => {
    let timeout: number

    const scheduleBlink = () => {
      timeout = window.setTimeout(
        () => {
          setBlinking(true)
          window.setTimeout(() => setBlinking(false), 130)
          scheduleBlink()
        },
        2600 + Math.random() * 3800,
      )
    }

    scheduleBlink()
    return () => window.clearTimeout(timeout)
  }, [])

  const shape = MOUTH_SHAPES[paused ? 'rest' : viseme] ?? MOUTH_SHAPES.rest

  return (
    <div className={cn('flex flex-col items-center gap-3', className)}>
      <div
        className={cn(
          'relative rounded-full transition-shadow duration-500',
          speaking && !paused
            ? 'shadow-[0_0_60px_rgba(34,211,238,0.35)]'
            : 'shadow-[0_0_28px_rgba(34,211,238,0.14)]',
        )}
      >
        {/* Concentric rings — expand while speaking */}
        <div
          className={cn(
            'absolute inset-0 rounded-full border border-cyan-400/30 transition-transform duration-700',
            speaking && !paused ? 'scale-110' : 'scale-100',
          )}
          aria-hidden="true"
        />
        <div
          className={cn(
            'absolute inset-0 rounded-full border border-cyan-300/15 transition-transform duration-1000',
            speaking && !paused ? 'scale-125' : 'scale-100',
          )}
          aria-hidden="true"
        />

        <svg
          viewBox="0 0 200 200"
          className={cn(
            'relative size-40 transition-opacity duration-300 sm:size-48',
            paused && 'opacity-60',
          )}
          role="img"
          aria-label={`Maya, the AI teacher${speaking && !paused ? ', speaking' : ''}`}
        >
          <defs>
            <radialGradient id="maya-face" cx="50%" cy="42%" r="62%">
              <stop offset="0%" stopColor="#7DD9F0" stopOpacity="0.95" />
              <stop offset="55%" stopColor="#3AA8D8" stopOpacity="0.75" />
              <stop offset="100%" stopColor="#0B2740" stopOpacity="0.9" />
            </radialGradient>
            <linearGradient id="maya-hair" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#67E8F9" stopOpacity="0.55" />
              <stop offset="100%" stopColor="#1E5B84" stopOpacity="0.75" />
            </linearGradient>
            <radialGradient id="maya-halo" cx="50%" cy="50%" r="50%">
              <stop offset="60%" stopColor="#22D3EE" stopOpacity="0" />
              <stop offset="100%" stopColor="#22D3EE" stopOpacity="0.22" />
            </radialGradient>
          </defs>

          {/* Halo */}
          <circle cx="100" cy="100" r="96" fill="url(#maya-halo)" />

          {/* Shoulders */}
          <path
            d="M 44 200 Q 48 164 76 154 L 124 154 Q 152 164 156 200 Z"
            fill="url(#maya-hair)"
            opacity="0.55"
          />

          {/* Neck */}
          <path d="M 88 138 L 88 158 Q 100 164 112 158 L 112 138 Z" fill="#2B7BA8" opacity="0.8" />

          {/* Hair behind */}
          <path
            d="M 58 96 Q 56 44 100 40 Q 144 44 142 96 L 142 118 Q 138 74 100 70 Q 62 74 58 118 Z"
            fill="url(#maya-hair)"
          />

          {/* Face */}
          <ellipse cx="100" cy="100" rx="40" ry="50" fill="url(#maya-face)" />

          {/* Circuit tracery — echoes the product's holographic language */}
          <g stroke="#A5F3FC" strokeWidth="0.7" opacity="0.32" fill="none">
            <path d="M 68 92 L 60 92 L 56 86" />
            <path d="M 132 92 L 140 92 L 144 86" />
            <path d="M 70 116 L 62 122 L 62 130" />
            <path d="M 130 116 L 138 122 L 138 130" />
            <circle cx="56" cy="86" r="1.6" fill="#A5F3FC" />
            <circle cx="144" cy="86" r="1.6" fill="#A5F3FC" />
            <circle cx="62" cy="130" r="1.6" fill="#A5F3FC" />
            <circle cx="138" cy="130" r="1.6" fill="#A5F3FC" />
          </g>

          {/* Brows */}
          <path d="M 76 86 Q 85 82 94 85" stroke="#CFFAFE" strokeWidth="2" fill="none" opacity="0.55" strokeLinecap="round" />
          <path d="M 106 85 Q 115 82 124 86" stroke="#CFFAFE" strokeWidth="2" fill="none" opacity="0.55" strokeLinecap="round" />

          {/* Eyes */}
          <g>
            {blinking ? (
              <>
                <path d="M 78 98 Q 85 101 92 98" stroke="#E0F7FF" strokeWidth="2" fill="none" strokeLinecap="round" />
                <path d="M 108 98 Q 115 101 122 98" stroke="#E0F7FF" strokeWidth="2" fill="none" strokeLinecap="round" />
              </>
            ) : (
              <>
                <ellipse cx="85" cy="98" rx="7.5" ry="5.5" fill="#E8FBFF" opacity="0.92" />
                <ellipse cx="115" cy="98" rx="7.5" ry="5.5" fill="#E8FBFF" opacity="0.92" />
                <circle cx="85" cy="98" r="3.4" fill="#0E7490" />
                <circle cx="115" cy="98" r="3.4" fill="#0E7490" />
                <circle cx="86.4" cy="96.6" r="1.2" fill="#FFFFFF" />
                <circle cx="116.4" cy="96.6" r="1.2" fill="#FFFFFF" />
              </>
            )}
          </g>

          {/* Nose */}
          <path d="M 100 104 L 97 118 Q 100 120 103 118" stroke="#BAE6FD" strokeWidth="1.4" fill="none" opacity="0.5" strokeLinecap="round" />

          {/* Mouth — the shape that follows speech */}
          <g style={{ transition: 'opacity 60ms linear' }}>
            <path
              d={shape.d}
              fill={shape.inner ? '#0B2740' : 'none'}
              stroke="#F0ABFC"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity="0.9"
            />
            {shape.inner && <path d={shape.inner} fill="#4C1D3D" opacity="0.75" />}
          </g>

          {/* Hair front */}
          <path
            d="M 60 94 Q 58 46 100 42 Q 142 46 140 94 Q 132 68 100 66 Q 74 66 60 94 Z"
            fill="url(#maya-hair)"
            opacity="0.92"
          />
        </svg>
      </div>

      <div className="text-center">
        <p className="text-xs uppercase tracking-[0.26em] text-cyan-300/80">AI tutor</p>
        <h2 className="mt-1 text-2xl font-semibold text-white">Maya</h2>
        {status && <p className="mt-1 text-xs text-slate-400">{status}</p>}
      </div>
    </div>
  )
}
