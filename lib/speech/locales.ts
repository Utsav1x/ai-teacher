/**
 * Lesson language → locale → neural voice.
 *
 * Three places need to turn "Marathi" into a voice: the live narration route,
 * the D-ID video pipeline, and the client hook deciding whether the browser can
 * cope on its own. They used to disagree — the classroom looked for a voice
 * installed in Windows and gave up, while the server had `mr-IN-AarohiNeural`
 * available the whole time.
 *
 * Every name in VOICE_BY_LOCALE was checked against the live Edge catalogue
 * (322 voices). Microsoft's Azure catalogue uses the same names, which is why
 * D-ID can be handed these values directly.
 */

/** Lesson language names (as offered on /start) → BCP-47 locale. */
export const LANGUAGE_LOCALES: Record<string, string> = {
  english: 'en-IN',
  hindi: 'hi-IN',
  hinglish: 'hi-IN',
  bengali: 'bn-IN',
  gujarati: 'gu-IN',
  kannada: 'kn-IN',
  malayalam: 'ml-IN',
  marathi: 'mr-IN',
  tamil: 'ta-IN',
  telugu: 'te-IN',
  urdu: 'ur-IN',
  spanish: 'es-ES',
  french: 'fr-FR',
  german: 'de-DE',
  mandarin: 'zh-CN',
  chinese: 'zh-CN',
  japanese: 'ja-JP',
  korean: 'ko-KR',
  portuguese: 'pt-BR',
  russian: 'ru-RU',
  arabic: 'ar-EG',
}

/**
 * A known-good voice per locale, so nothing depends on a catalogue lookup
 * succeeding. Female throughout, to stay consistent with Maya.
 */
export const VOICE_BY_LOCALE: Record<string, string> = {
  'en-IN': 'en-IN-NeerjaNeural',
  'hi-IN': 'hi-IN-SwaraNeural',
  'bn-IN': 'bn-IN-TanishaaNeural',
  'gu-IN': 'gu-IN-DhwaniNeural',
  'kn-IN': 'kn-IN-SapnaNeural',
  'ml-IN': 'ml-IN-SobhanaNeural',
  'mr-IN': 'mr-IN-AarohiNeural',
  'ta-IN': 'ta-IN-PallaviNeural',
  'te-IN': 'te-IN-ShrutiNeural',
  'ur-IN': 'ur-IN-GulNeural',
  'es-ES': 'es-ES-ElviraNeural',
  'fr-FR': 'fr-FR-DeniseNeural',
  'de-DE': 'de-DE-KatjaNeural',
  'zh-CN': 'zh-CN-XiaoxiaoNeural',
  'ja-JP': 'ja-JP-NanamiNeural',
  'ko-KR': 'ko-KR-SunHiNeural',
  'pt-BR': 'pt-BR-FranciscaNeural',
  'ru-RU': 'ru-RU-SvetlanaNeural',
  'ar-EG': 'ar-EG-SalmaNeural',
}

export const DEFAULT_LOCALE = 'en-IN'

export function localeForLanguage(language: string): string {
  return LANGUAGE_LOCALES[language.trim().toLowerCase()] ?? DEFAULT_LOCALE
}

/** The neural voice to speak a lesson language in. Never throws. */
export function voiceForLanguage(language: string): string {
  const locale = localeForLanguage(language)
  return VOICE_BY_LOCALE[locale] ?? VOICE_BY_LOCALE[DEFAULT_LOCALE]!
}
