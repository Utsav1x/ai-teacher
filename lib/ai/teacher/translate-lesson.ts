import type { AILesson } from '../types'

/**
 * Flattens a lesson into a map of translatable strings, and rebuilds it.
 *
 * Switching language mid-lesson must not change what is being taught — the
 * learner keeps their place, their score and their checkpoints. Translating the
 * whole JSON object would risk the model renumbering options, dropping a
 * section, or moving `correctIndex`, which would silently mark right answers
 * wrong.
 *
 * So only the human-readable strings travel. Indices, question types,
 * difficulties, minute counts and `correctIndex` never leave the client, and
 * the translated values are merged back into the original structure.
 */

/** Reversible keys — `q.1.opt.2` is question 1, option 2. */
export function extractStrings(lesson: AILesson): Record<string, string> {
  const out: Record<string, string> = {}
  const put = (key: string, value?: string) => {
    if (value && value.trim()) out[key] = value
  }

  put('title', lesson.title)
  put('subtitle', lesson.subtitle)
  put('objective', lesson.objective)
  put('summary', lesson.summary)
  put('teachingPrompt', lesson.teachingPrompt)
  put('reexplanation', lesson.reexplanation)
  put('completionMessage', lesson.completionMessage)
  put('nextTopicSuggestion', lesson.nextTopicSuggestion)
  put('visualRationale', lesson.visualRationale)

  lesson.keyPoints?.forEach((point, i) => put(`kp.${i}`, point))

  lesson.sections?.forEach((section, i) => {
    put(`s.${i}.title`, section.title)
    put(`s.${i}.description`, section.description)
  })

  const questions = lesson.questions?.length ? lesson.questions : [lesson.question]
  questions.forEach((question, qi) => {
    if (!question) return
    put(`q.${qi}.prompt`, question.prompt)
    put(`q.${qi}.explanation`, question.explanation)
    put(`q.${qi}.teacherPrompt`, question.teacherPrompt)
    put(`q.${qi}.concept`, question.concept)
    put(`q.${qi}.expectedAnswer`, question.expectedAnswer)
    question.options?.forEach((opt, oi) => put(`q.${qi}.opt.${oi}`, opt))
  })

  return out
}

/**
 * Rebuilds the lesson with translated strings.
 *
 * Anything missing from the translation keeps its original value, so a partial
 * response degrades to a partly-translated lesson rather than an empty one.
 */
export function applyStrings(lesson: AILesson, t: Record<string, string>): AILesson {
  const get = (key: string, fallback: string) => t[key]?.trim() || fallback
  const getOpt = (key: string, fallback?: string) =>
    t[key]?.trim() || fallback

  const questions = lesson.questions?.length ? lesson.questions : [lesson.question]

  const translatedQuestions = questions.map((question, qi) => ({
    ...question,
    prompt: get(`q.${qi}.prompt`, question.prompt),
    explanation: get(`q.${qi}.explanation`, question.explanation),
    teacherPrompt: get(`q.${qi}.teacherPrompt`, question.teacherPrompt),
    concept: getOpt(`q.${qi}.concept`, question.concept),
    expectedAnswer: getOpt(`q.${qi}.expectedAnswer`, question.expectedAnswer),
    // correctIndex, type and difficulty are deliberately untouched.
    options: question.options?.map((opt, oi) => get(`q.${qi}.opt.${oi}`, opt)),
  }))

  return {
    ...lesson,
    title: get('title', lesson.title),
    subtitle: get('subtitle', lesson.subtitle),
    objective: get('objective', lesson.objective),
    summary: get('summary', lesson.summary),
    teachingPrompt: get('teachingPrompt', lesson.teachingPrompt),
    reexplanation: get('reexplanation', lesson.reexplanation),
    completionMessage: get('completionMessage', lesson.completionMessage),
    nextTopicSuggestion: getOpt('nextTopicSuggestion', lesson.nextTopicSuggestion),
    visualRationale: getOpt('visualRationale', lesson.visualRationale),
    keyPoints: lesson.keyPoints?.map((p, i) => get(`kp.${i}`, p)) ?? [],
    sections:
      lesson.sections?.map((section, i) => ({
        ...section,
        title: get(`s.${i}.title`, section.title),
        description: get(`s.${i}.description`, section.description),
      })) ?? [],
    question: translatedQuestions[0] ?? lesson.question,
    questions: lesson.questions?.length ? translatedQuestions : undefined,
  }
}
