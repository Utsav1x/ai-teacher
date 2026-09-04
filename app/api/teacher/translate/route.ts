/**
 * POST /api/teacher/translate
 *
 * Restates a lesson's text in another language, mid-lesson.
 *
 * Takes a flat map of strings rather than the lesson object, so question
 * indices, `correctIndex`, difficulties and section ordering never reach the
 * model and cannot be disturbed. The client merges the response back into the
 * lesson it already has, which is what lets the learner keep their place, their
 * score and their answered checkpoints across a language change.
 *
 * Request:  { targetLanguage: string, strings: Record<string, string> }
 * Response: { strings: Record<string, string> }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getAIProvider } from '@/lib/ai/providers'
import {
  TRANSLATE_LESSON_SYSTEM,
  buildTranslateUserPrompt,
} from '@/lib/ai/teacher/prompts'

/** A whole lesson is well under this; the cap guards against a runaway payload. */
const MAX_KEYS = 120
const MAX_CHARS = 24000

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  if (!supabase) {
    return NextResponse.json({ error: 'Database unavailable' }, { status: 503 })
  }

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { targetLanguage?: string; strings?: Record<string, string> }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const targetLanguage = body.targetLanguage?.trim()
  const strings = body.strings

  if (!targetLanguage) {
    return NextResponse.json({ error: 'Missing required field: targetLanguage' }, { status: 400 })
  }
  if (!strings || typeof strings !== 'object' || Array.isArray(strings)) {
    return NextResponse.json({ error: 'Missing required field: strings' }, { status: 400 })
  }

  const keys = Object.keys(strings)
  if (keys.length === 0) {
    return NextResponse.json({ strings: {} })
  }
  if (keys.length > MAX_KEYS) {
    return NextResponse.json({ error: `Too many strings (max ${MAX_KEYS}).` }, { status: 400 })
  }

  const totalChars = Object.values(strings).join('').length
  if (totalChars > MAX_CHARS) {
    return NextResponse.json({ error: `Lesson text exceeds ${MAX_CHARS} characters.` }, { status: 400 })
  }

  let provider
  try {
    provider = getAIProvider()
  } catch (err) {
    console.error('[translate] Provider init failed:', err)
    return NextResponse.json(
      { error: 'AI provider is not configured. Add GOOGLE_AI_API_KEY to .env.local.' },
      { status: 503 },
    )
  }

  try {
    const raw = await provider.generateJSON<Record<string, unknown>>(
      TRANSLATE_LESSON_SYSTEM,
      buildTranslateUserPrompt({ targetLanguage, strings }),
      { temperature: 0.3 },
    )

    // Keep only keys we asked for, as strings. A hallucinated or missing key
    // then falls back to the original text rather than corrupting the lesson.
    const cleaned: Record<string, string> = {}
    for (const key of keys) {
      const value = raw?.[key]
      if (typeof value === 'string' && value.trim()) cleaned[key] = value
    }

    const translated = Object.keys(cleaned).length
    console.log(`[translate] ${translated}/${keys.length} strings → ${targetLanguage}`)

    if (translated === 0) {
      return NextResponse.json(
        { error: 'The model returned nothing usable for this language.' },
        { status: 502 },
      )
    }

    return NextResponse.json({ strings: cleaned })
  } catch (err) {
    console.error('[translate] Failed:', err)
    return NextResponse.json(
      { error: String(err instanceof Error ? err.message : err) },
      { status: 500 },
    )
  }
}
