/**
 * Viseme mapping for avatar lip-sync.
 *
 * The Web Speech API emits `boundary` events per *word*, not per phoneme, so
 * true phoneme-level sync is not available. Instead each spoken word is
 * converted to a plausible sequence of mouth shapes which the avatar plays
 * across that word's duration. The result reads as speech because the timing
 * comes from the real utterance — only the shapes are approximated.
 *
 * Six shapes is the standard minimum for readable lip-sync (the classic
 * Preston Blair animation set reduced for real-time use).
 */

export type Viseme =
  | 'rest'   // mouth closed, neutral
  | 'closed' // m, b, p — lips pressed
  | 'wide'   // e, i — corners pulled back
  | 'open'   // a — jaw dropped
  | 'round'  // o, u, w — lips rounded
  | 'teeth'  // f, v — lower lip to teeth

/** Latin letters → viseme. Anything unmapped falls through to 'rest'. */
const LETTER_VISEMES: Record<string, Viseme> = {
  a: 'open', á: 'open', à: 'open', ä: 'open',
  e: 'wide', é: 'wide', è: 'wide', ê: 'wide',
  i: 'wide', í: 'wide', y: 'wide',
  o: 'round', ó: 'round', ô: 'round', ö: 'round',
  u: 'round', ú: 'round', ü: 'round', w: 'round',
  m: 'closed', b: 'closed', p: 'closed',
  f: 'teeth', v: 'teeth',
  c: 'wide', d: 'wide', g: 'open', h: 'open',
  j: 'wide', k: 'open', l: 'wide', n: 'wide',
  q: 'round', r: 'round', s: 'wide', t: 'wide',
  x: 'wide', z: 'wide',
}

/**
 * Devanagari vowel signs and independent vowels, so Hindi and Hinglish
 * lessons animate rather than sitting at rest.
 */
const DEVANAGARI_VISEMES: Record<string, Viseme> = {
  'अ': 'open', 'आ': 'open', 'ा': 'open',
  'इ': 'wide', 'ई': 'wide', 'ि': 'wide', 'ी': 'wide',
  'उ': 'round', 'ऊ': 'round', 'ु': 'round', 'ू': 'round',
  'ए': 'wide', 'ऐ': 'wide', 'े': 'wide', 'ै': 'wide',
  'ओ': 'round', 'औ': 'round', 'ो': 'round', 'ौ': 'round',
  'म': 'closed', 'ब': 'closed', 'प': 'closed', 'भ': 'closed',
  'फ': 'teeth', 'व': 'teeth',
}

/**
 * Converts a word into the mouth shapes to play while it is spoken.
 *
 * Consecutive duplicates are collapsed — holding one shape reads as a longer
 * vowel, which is what actually happens in speech, and avoids a jittery mouth
 * on words like "sees".
 */
export function wordToVisemes(word: string): Viseme[] {
  const shapes: Viseme[] = []

  for (const char of word.toLowerCase()) {
    const viseme = DEVANAGARI_VISEMES[char] ?? LETTER_VISEMES[char]
    if (!viseme) continue
    if (shapes[shapes.length - 1] !== viseme) shapes.push(viseme)
  }

  // Punctuation-only or unmapped scripts still need a beat of movement.
  if (shapes.length === 0) return ['open']

  return shapes
}

/**
 * How long to hold each shape, in milliseconds.
 *
 * Derived from the word's own length so long words animate longer, clamped so
 * a very long word does not crawl and a one-letter word does not flicker.
 */
export function visemeHoldMs(word: string, shapeCount: number): number {
  const estimatedWordMs = Math.min(900, Math.max(180, word.length * 70))
  return Math.max(60, Math.round(estimatedWordMs / Math.max(1, shapeCount)))
}
