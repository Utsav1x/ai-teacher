/**
 * POST /api/teacher/speak
 *
 * Text → spoken audio.
 *
 * Exists because `speechSynthesis` emits sound to the output device and cannot
 * be captured into a MediaStream — so the lesson video could otherwise only get
 * narration by asking the viewer to share their screen.
 *
 * Two providers, in order:
 *   1. Microsoft Edge's neural voices. No API key, no quota, 300+ voices
 *      including 21 Indian ones. This is the everyday path.
 *   2. Gemini TTS, as a fallback if Edge is unreachable. Better prosody, but
 *      a free-tier daily quota that a couple of videos will exhaust.
 *
 * Request:  { text: string, language?: string }
 * Response: audio/mpeg (Edge) or audio/wav (Gemini)
 */

import { NextRequest, NextResponse } from 'next/server'
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { localeForLanguage, voiceForLanguage } from '@/lib/speech/locales'

/** msedge-tts speaks over a WebSocket, so this cannot run on the edge runtime. */
export const runtime = 'nodejs'

const MAX_CHARS = 3000

// ─── Edge TTS ─────────────────────────────────────────────────────────────────

type EdgeVoice = { Name?: string; ShortName?: string; Locale?: string; Gender?: string }

/** Voice list is stable and ~322 entries — fetch once per server process. */
let voiceCache: EdgeVoice[] | null = null

async function resolveVoice(language: string): Promise<string> {
  const locale = localeForLanguage(language)

  try {
    if (!voiceCache) {
      voiceCache = (await new MsEdgeTTS().getVoices()) as EdgeVoice[]
    }

    const named = (v: EdgeVoice) => v.ShortName ?? v.Name ?? ''
    const inLocale = voiceCache.filter((v) => named(v).startsWith(locale + '-'))

    // Prefer a female voice for consistency with Maya, else anything matching,
    // else fall back to the language prefix alone (e.g. any "hi-" voice).
    const female = inLocale.find((v) => v.Gender === 'Female')
    if (female) return named(female)
    if (inLocale[0]) return named(inLocale[0])

    const prefix = locale.split('-')[0]!
    const anyMatch = voiceCache.find((v) => named(v).startsWith(prefix + '-'))
    if (anyMatch) return named(anyMatch)
  } catch {
    // Fall through to a known-good default.
  }

  return voiceForLanguage(language)
}

async function synthesizeWithEdge(text: string, language: string): Promise<Buffer | null> {
  try {
    const voice = await resolveVoice(language)
    const tts = new MsEdgeTTS()
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3)

    const { audioStream } = tts.toStream(text)
    const chunks: Buffer[] = []

    return await new Promise<Buffer | null>((resolve) => {
      const timeout = setTimeout(() => resolve(null), 25000)

      audioStream.on('data', (chunk: Buffer) => chunks.push(chunk))
      audioStream.on('end', () => {
        clearTimeout(timeout)
        const buf = Buffer.concat(chunks)
        resolve(buf.length > 0 ? buf : null)
      })
      audioStream.on('error', () => {
        clearTimeout(timeout)
        resolve(null)
      })
    })
  } catch {
    return null
  }
}

// ─── Gemini TTS (fallback) ────────────────────────────────────────────────────

const GEMINI_TTS_MODELS = ['gemini-3.1-flash-tts-preview', 'gemini-2.5-flash-preview-tts']
const SAMPLE_RATE = 24000
const CHANNELS = 1
const BITS_PER_SAMPLE = 16

/** Wraps Gemini's raw PCM in a WAV container so browsers can decode it. */
function pcmToWav(pcm: Buffer): Buffer {
  const byteRate = (SAMPLE_RATE * CHANNELS * BITS_PER_SAMPLE) / 8
  const blockAlign = (CHANNELS * BITS_PER_SAMPLE) / 8
  const header = Buffer.alloc(44)

  header.write('RIFF', 0)
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(CHANNELS, 22)
  header.writeUInt32LE(SAMPLE_RATE, 24)
  header.writeUInt32LE(byteRate, 28)
  header.writeUInt16LE(blockAlign, 32)
  header.writeUInt16LE(BITS_PER_SAMPLE, 34)
  header.write('data', 36)
  header.writeUInt32LE(pcm.length, 40)

  return Buffer.concat([header, pcm])
}

async function synthesizeWithGemini(text: string): Promise<Buffer | null> {
  const apiKey = process.env.GOOGLE_AI_API_KEY?.trim()
  if (!apiKey) return null

  for (const model of GEMINI_TTS_MODELS) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text }] }],
            generationConfig: {
              responseModalities: ['AUDIO'],
              speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
            },
          }),
        },
      )
      if (!res.ok) continue

      const json = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string } }> } }>
      }
      const base64 = json.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data
      if (base64) return pcmToWav(Buffer.from(base64, 'base64'))
    } catch {
      // Try the next model.
    }
  }

  return null
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  if (!supabase) {
    return NextResponse.json({ error: 'Database unavailable' }, { status: 503 })
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { text?: string; language?: string }
  try {
    body = (await req.json()) as { text?: string; language?: string }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const text = body.text?.trim()
  if (!text) {
    return NextResponse.json({ error: 'Missing required field: text' }, { status: 400 })
  }
  if (text.length > MAX_CHARS) {
    return NextResponse.json(
      { error: `Text exceeds ${MAX_CHARS} characters. Split it into shorter segments.` },
      { status: 400 },
    )
  }

  const language = body.language?.trim() || 'English'

  const mp3 = await synthesizeWithEdge(text, language)
  if (mp3) {
    return new NextResponse(new Uint8Array(mp3), {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': String(mp3.length),
        'Cache-Control': 'no-store',
      },
    })
  }

  console.warn('[speak] Edge TTS unavailable, falling back to Gemini.')

  const wav = await synthesizeWithGemini(text)
  if (wav) {
    return new NextResponse(new Uint8Array(wav), {
      status: 200,
      headers: {
        'Content-Type': 'audio/wav',
        'Content-Length': String(wav.length),
        'Cache-Control': 'no-store',
      },
    })
  }

  console.error('[speak] Both TTS providers failed.')
  return NextResponse.json({ error: 'Could not generate narration audio.' }, { status: 502 })
}
