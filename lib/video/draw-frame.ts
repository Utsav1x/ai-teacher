/**
 * Canvas painter for the exported lesson video.
 *
 * Redraws Maya and the current slide each frame. Kept separate from the React
 * avatar so the recording is not tied to DOM layout — a canvas can be captured
 * with `captureStream()`, a DOM subtree cannot.
 */

import type { Viseme } from '@/lib/speech/visemes'

export const VIDEO_WIDTH = 1280
export const VIDEO_HEIGHT = 720

export interface FrameState {
  lessonTitle: string
  heading: string
  /** Badge text — e.g. "Concept", "Question". */
  kind: string
  /** Caption shown along the bottom. */
  caption: string
  keyPoints: string[]
  /** Fenced-block content already stripped of its fence. */
  visual?: string
  viseme: Viseme
  speaking: boolean
  /** 0–1, drives the progress bar. */
  progress: number
  language: string
}

const INK = '#E2E8F0'
const MUTED = '#94A3B8'
const CYAN = '#22D3EE'

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/** Wraps text to a width, returning the lines that fit within maxLines. */
function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ''

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word
    if (ctx.measureText(candidate).width <= maxWidth) {
      line = candidate
      continue
    }
    if (line) lines.push(line)
    line = word
    if (lines.length === maxLines) break
  }

  if (line && lines.length < maxLines) lines.push(line)

  if (lines.length === maxLines && words.length > lines.join(' ').split(/\s+/).length) {
    lines[maxLines - 1] = lines[maxLines - 1]!.replace(/\s+\S*$/, '') + '…'
  }

  return lines
}

// ─── Avatar ───────────────────────────────────────────────────────────────────

/** Mouth geometry per viseme, in the avatar's local 200×200 space. */
function drawMouth(ctx: CanvasRenderingContext2D, viseme: Viseme) {
  ctx.strokeStyle = '#F0ABFC'
  ctx.lineWidth = 2.4
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.fillStyle = '#3B1330'

  ctx.beginPath()

  switch (viseme) {
    case 'open':
      ctx.moveTo(84, 126)
      ctx.quadraticCurveTo(100, 156, 116, 126)
      ctx.quadraticCurveTo(100, 134, 84, 126)
      ctx.closePath()
      ctx.fill()
      break
    case 'round':
      ctx.ellipse(100, 135, 10, 13, 0, 0, Math.PI * 2)
      ctx.fill()
      break
    case 'wide':
      ctx.moveTo(76, 130)
      ctx.quadraticCurveTo(100, 143, 124, 130)
      ctx.quadraticCurveTo(100, 136, 76, 130)
      ctx.closePath()
      ctx.fill()
      break
    case 'teeth':
      ctx.moveTo(80, 130)
      ctx.quadraticCurveTo(100, 128, 120, 130)
      ctx.quadraticCurveTo(100, 142, 80, 130)
      ctx.closePath()
      ctx.fill()
      break
    case 'closed':
      ctx.moveTo(80, 132)
      ctx.quadraticCurveTo(100, 134, 120, 132)
      break
    default:
      ctx.moveTo(82, 132)
      ctx.quadraticCurveTo(100, 138, 118, 132)
  }

  ctx.stroke()
}

function drawAvatar(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  scale: number,
  state: FrameState,
  time: number,
) {
  ctx.save()
  ctx.translate(cx, cy)
  ctx.scale(scale, scale)
  ctx.translate(-100, -100)

  // Halo — breathes while speaking
  const pulse = state.speaking ? 1 + Math.sin(time / 260) * 0.035 : 1
  ctx.save()
  ctx.translate(100, 100)
  ctx.scale(pulse, pulse)
  ctx.translate(-100, -100)

  const halo = ctx.createRadialGradient(100, 100, 40, 100, 100, 104)
  halo.addColorStop(0, 'rgba(34,211,238,0)')
  halo.addColorStop(1, 'rgba(34,211,238,0.22)')
  ctx.fillStyle = halo
  ctx.beginPath()
  ctx.arc(100, 100, 104, 0, Math.PI * 2)
  ctx.fill()

  ctx.strokeStyle = 'rgba(34,211,238,0.32)'
  ctx.lineWidth = 1.4
  ctx.beginPath()
  ctx.arc(100, 100, 92, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()

  // Shoulders
  ctx.fillStyle = 'rgba(30,91,132,0.7)'
  ctx.beginPath()
  ctx.moveTo(44, 200)
  ctx.quadraticCurveTo(48, 164, 76, 154)
  ctx.lineTo(124, 154)
  ctx.quadraticCurveTo(152, 164, 156, 200)
  ctx.closePath()
  ctx.fill()

  // Neck
  ctx.fillStyle = 'rgba(43,123,168,0.85)'
  ctx.beginPath()
  ctx.moveTo(88, 138)
  ctx.lineTo(88, 158)
  ctx.quadraticCurveTo(100, 164, 112, 158)
  ctx.lineTo(112, 138)
  ctx.closePath()
  ctx.fill()

  // Hair behind
  const hair = ctx.createLinearGradient(58, 40, 142, 130)
  hair.addColorStop(0, 'rgba(103,232,249,0.6)')
  hair.addColorStop(1, 'rgba(30,91,132,0.8)')
  ctx.fillStyle = hair
  ctx.beginPath()
  ctx.moveTo(58, 96)
  ctx.quadraticCurveTo(56, 44, 100, 40)
  ctx.quadraticCurveTo(144, 44, 142, 96)
  ctx.lineTo(142, 118)
  ctx.quadraticCurveTo(138, 74, 100, 70)
  ctx.quadraticCurveTo(62, 74, 58, 118)
  ctx.closePath()
  ctx.fill()

  // Face
  const face = ctx.createRadialGradient(100, 84, 10, 100, 100, 62)
  face.addColorStop(0, 'rgba(125,217,240,0.95)')
  face.addColorStop(0.55, 'rgba(58,168,216,0.78)')
  face.addColorStop(1, 'rgba(11,39,64,0.92)')
  ctx.fillStyle = face
  ctx.beginPath()
  ctx.ellipse(100, 100, 40, 50, 0, 0, Math.PI * 2)
  ctx.fill()

  // Brows
  ctx.strokeStyle = 'rgba(207,250,254,0.55)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(76, 86)
  ctx.quadraticCurveTo(85, 82, 94, 85)
  ctx.moveTo(106, 85)
  ctx.quadraticCurveTo(115, 82, 124, 86)
  ctx.stroke()

  // Eyes — blink on a slow irregular cycle
  const blink = Math.sin(time / 1400) > 0.985
  if (blink) {
    ctx.strokeStyle = '#E0F7FF'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(78, 98)
    ctx.quadraticCurveTo(85, 101, 92, 98)
    ctx.moveTo(108, 98)
    ctx.quadraticCurveTo(115, 101, 122, 98)
    ctx.stroke()
  } else {
    for (const ex of [85, 115]) {
      ctx.fillStyle = 'rgba(232,251,255,0.93)'
      ctx.beginPath()
      ctx.ellipse(ex, 98, 7.5, 5.5, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#0E7490'
      ctx.beginPath()
      ctx.arc(ex, 98, 3.4, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#FFFFFF'
      ctx.beginPath()
      ctx.arc(ex + 1.4, 96.6, 1.2, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  // Nose
  ctx.strokeStyle = 'rgba(186,230,253,0.5)'
  ctx.lineWidth = 1.4
  ctx.beginPath()
  ctx.moveTo(100, 104)
  ctx.lineTo(97, 118)
  ctx.quadraticCurveTo(100, 120, 103, 118)
  ctx.stroke()

  drawMouth(ctx, state.viseme)

  // Hair front
  ctx.fillStyle = hair
  ctx.beginPath()
  ctx.moveTo(60, 94)
  ctx.quadraticCurveTo(58, 46, 100, 42)
  ctx.quadraticCurveTo(142, 46, 140, 94)
  ctx.quadraticCurveTo(132, 68, 100, 66)
  ctx.quadraticCurveTo(74, 66, 60, 94)
  ctx.closePath()
  ctx.fill()

  ctx.restore()
}

// ─── Frame ────────────────────────────────────────────────────────────────────

export function drawFrame(
  ctx: CanvasRenderingContext2D,
  state: FrameState,
  time: number,
) {
  const W = VIDEO_WIDTH
  const H = VIDEO_HEIGHT

  // Background
  const bg = ctx.createLinearGradient(0, 0, W, H)
  bg.addColorStop(0, '#081522')
  bg.addColorStop(0.45, '#0B172A')
  bg.addColorStop(1, '#081522')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)

  const glow = ctx.createRadialGradient(W * 0.28, H * 0.4, 0, W * 0.28, H * 0.4, 420)
  glow.addColorStop(0, 'rgba(56,189,248,0.14)')
  glow.addColorStop(1, 'rgba(56,189,248,0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, W, H)

  // ── Header ────────────────────────────────────────────────────────────────
  ctx.fillStyle = CYAN
  ctx.font = '600 15px system-ui, -apple-system, Segoe UI, sans-serif'
  ctx.fillText('LUMINA · AI TEACHER', 56, 56)

  ctx.fillStyle = MUTED
  ctx.font = '400 15px system-ui, -apple-system, Segoe UI, sans-serif'
  const langLabel = state.language.toUpperCase()
  ctx.fillText(langLabel, W - 56 - ctx.measureText(langLabel).width, 56)

  ctx.fillStyle = INK
  ctx.font = '600 26px system-ui, -apple-system, Segoe UI, sans-serif'
  for (const [i, line] of wrapText(ctx, state.lessonTitle, W - 112, 1).entries()) {
    ctx.fillText(line, 56, 96 + i * 32)
  }

  // ── Avatar panel ──────────────────────────────────────────────────────────
  ctx.fillStyle = 'rgba(15,23,42,0.5)'
  roundRect(ctx, 56, 132, 380, 400, 24)
  ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,0.08)'
  ctx.lineWidth = 1
  ctx.stroke()

  drawAvatar(ctx, 246, 296, 1.45, state, time)

  ctx.textAlign = 'center'
  ctx.fillStyle = CYAN
  ctx.font = '600 12px system-ui, sans-serif'
  ctx.fillText('AI TUTOR', 246, 470)
  ctx.fillStyle = INK
  ctx.font = '600 28px system-ui, sans-serif'
  ctx.fillText('Maya', 246, 502)
  ctx.textAlign = 'left'

  // ── Slide panel ───────────────────────────────────────────────────────────
  const sx = 472
  const sw = W - sx - 56

  ctx.fillStyle = 'rgba(15,23,42,0.5)'
  roundRect(ctx, sx, 132, sw, 400, 24)
  ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,0.08)'
  ctx.stroke()

  // Kind badge
  ctx.font = '600 12px system-ui, sans-serif'
  const badgeW = ctx.measureText(state.kind.toUpperCase()).width + 24
  ctx.fillStyle = 'rgba(34,211,238,0.14)'
  roundRect(ctx, sx + 28, 164, badgeW, 26, 13)
  ctx.fill()
  ctx.fillStyle = CYAN
  ctx.fillText(state.kind.toUpperCase(), sx + 40, 181)

  // Heading
  ctx.fillStyle = INK
  ctx.font = '600 30px system-ui, sans-serif'
  let y = 236
  for (const line of wrapText(ctx, state.heading, sw - 56, 2)) {
    ctx.fillText(line, sx + 28, y)
    y += 38
  }

  // Visual block, or key points
  y += 6
  if (state.visual) {
    const blockH = Math.min(190, 532 - y - 24)
    ctx.fillStyle = 'rgba(2,6,23,0.6)'
    roundRect(ctx, sx + 28, y, sw - 56, blockH, 14)
    ctx.fill()

    ctx.fillStyle = '#A5F3FC'
    ctx.font = '400 15px ui-monospace, Cascadia Mono, Consolas, monospace'
    const lines = state.visual.split('\n').slice(0, Math.floor((blockH - 28) / 21))
    lines.forEach((line, i) => {
      ctx.fillText(line.slice(0, 52), sx + 44, y + 30 + i * 21)
    })
  } else {
    ctx.font = '400 18px system-ui, sans-serif'
    for (const point of state.keyPoints.slice(0, 3)) {
      if (y > 500) break
      ctx.fillStyle = CYAN
      ctx.beginPath()
      ctx.arc(sx + 34, y - 6, 4, 0, Math.PI * 2)
      ctx.fill()

      ctx.fillStyle = MUTED
      for (const line of wrapText(ctx, point, sw - 84, 2)) {
        ctx.fillText(line, sx + 50, y)
        y += 26
      }
      y += 10
    }
  }

  // ── Caption bar ───────────────────────────────────────────────────────────
  ctx.fillStyle = 'rgba(2,6,23,0.72)'
  roundRect(ctx, 56, 556, W - 112, 104, 18)
  ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,0.07)'
  ctx.stroke()

  ctx.fillStyle = INK
  ctx.font = '400 21px system-ui, sans-serif'
  const captionLines = wrapText(ctx, state.caption, W - 168, 2)
  captionLines.forEach((line, i) => {
    ctx.fillText(line, 84, 594 + i * 30)
  })

  // ── Progress ──────────────────────────────────────────────────────────────
  ctx.fillStyle = 'rgba(148,163,184,0.22)'
  roundRect(ctx, 56, 684, W - 112, 6, 3)
  ctx.fill()

  const filled = Math.max(0, Math.min(1, state.progress)) * (W - 112)
  if (filled > 0) {
    const bar = ctx.createLinearGradient(56, 0, 56 + filled, 0)
    bar.addColorStop(0, '#22D3EE')
    bar.addColorStop(1, '#3B82F6')
    ctx.fillStyle = bar
    roundRect(ctx, 56, 684, filled, 6, 3)
    ctx.fill()
  }
}
