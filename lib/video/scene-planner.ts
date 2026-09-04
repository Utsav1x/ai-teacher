/**
 * Scene planner — converts an AILesson into a structured ScenePlan.
 *
 * Responsibility: decide WHAT to teach and in what order, with explicit signals
 * for when the avatar should be showing, when a visual should fill the scene,
 * and when the video should pause for student interaction.
 *
 * The Video Generation Pipeline reads this plan and decides HOW to render each
 * scene (avatar composition, visual overlay, transitions). Keeping these two
 * concerns separate means the Teacher Agent and the Video Pipeline can both
 * evolve independently.
 */

import type { AILesson, VisualType } from '@/lib/ai/types'

// ─── Scene types ──────────────────────────────────────────────────────────────

/**
 * What kind of scene this is.
 *
 * - 'intro'       — Teacher introduces the lesson topic
 * - 'concept'     — Teacher explains the core idea
 * - 'visual'      — Visual fills the frame; teacher voice continues
 * - 'example'     — Teacher walks through a worked example
 * - 'summary'     — Key points recap before the question
 * - 'question'    — Teacher poses the checkpoint question; video pauses here
 * - 'completion'  — Closing message after the student answers
 */
export type SceneType =
  | 'intro'
  | 'concept'
  | 'visual'
  | 'example'
  | 'summary'
  | 'question'
  | 'completion'

/** Where the teacher/avatar sits relative to the visual content. */
export type TeacherLayout =
  | 'full'        // Teacher fills the whole frame (intro, wrap-up)
  | 'left-panel'  // Teacher left ~40%, visual right ~60%
  | 'pip'         // Teacher tiny bottom-right; visual is full-screen
  | 'hidden'      // Pure visual, no avatar (rare)

export interface Scene {
  /** Index in the plan's scenes array. */
  index: number
  type: SceneType
  /** What the avatar/teacher should say. Fed to TTS and/or avatar API. */
  narration: string
  /** Layout directive for the rendering layer. */
  layout: TeacherLayout
  /** Optional visual content (already fence-stripped). */
  visual?: string
  /** Visual type for rendering decisions (code, diagram, formula…). */
  visualType?: VisualType
  /** Short label shown in the scene header, e.g. "Equation" or "Diagram". */
  visualLabel?: string
  /** Text that can be shown on-screen as a title or subtitle overlay. */
  onScreenText?: string
  /** Estimated duration in seconds (used for progress calculation). */
  durationSeconds: number
  /** Transition in — only 'cut' is supported for the D-ID pipeline. */
  transition: 'cut' | 'fade'
  /**
   * When true the video player should pause here and hand control back to the
   * interactive classroom so the student can answer the question.
   */
  pauseForInteraction: boolean
  /**
   * Which question index this scene corresponds to (into lesson.questions).
   * Only set on 'question' scenes.
   */
  questionIndex?: number
}

export interface ScenePlan {
  lessonId: string
  lessonTitle: string
  language: string
  scenes: Scene[]
  /** Total estimated duration across all scenes, in seconds. */
  totalDurationSeconds: number
}

// ─── Visual labels ────────────────────────────────────────────────────────────

const VISUAL_LABELS: Record<VisualType, string> = {
  code: 'Code example',
  formula: 'Equation',
  diagram: 'Diagram',
  timeline: 'Timeline',
  table: 'Comparison',
  graph: 'Plot',
}

// ─── Fence stripping ──────────────────────────────────────────────────────────

function stripFence(payload?: string): string | undefined {
  if (!payload?.trim()) return undefined
  const match = payload.trim().match(/^```(?:\w*)\n?([\s\S]*?)```$/)
  return (match ? match[1] : payload).trim() || undefined
}

// ─── Duration estimation ──────────────────────────────────────────────────────

/**
 * Rough speaking rate: ~140 wpm = ~2.33 words per second.
 * Adds padding per scene for transition and visual hold time.
 */
function estimateDuration(text: string, hasVisual: boolean): number {
  const words = text.split(/\s+/).filter(Boolean).length
  const speakSeconds = words / 2.33
  const holdSeconds = hasVisual ? 3 : 1.5
  return Math.ceil(speakSeconds + holdSeconds)
}

// ─── Main planner ─────────────────────────────────────────────────────────────

/**
 * Builds a scene plan from a generated lesson.
 *
 * The plan reflects the Teacher Agent's lesson structure (sections, keyPoints,
 * questions) without knowing anything about how it will be rendered.
 */
export function buildScenePlan(
  lesson: AILesson,
  language: string,
): ScenePlan {
  const scenes: Scene[] = []
  const visualBody = stripFence(lesson.visualPayload)
  const questionPool = lesson.questions?.length ? lesson.questions : [lesson.question]

  // ── Scene 0: Introduction ──────────────────────────────────────────────────
  const introNarration = lesson.summary
  scenes.push({
    index: 0,
    type: 'intro',
    narration: introNarration,
    layout: 'full',
    onScreenText: lesson.title,
    durationSeconds: estimateDuration(introNarration, false),
    transition: 'cut',
    pauseForInteraction: false,
  })

  // ── Scene 1: Core teaching — avatar + visual ───────────────────────────────
  const paragraphs = lesson.teachingPrompt
    .split(/\n{2,}|\n/)
    .map((p) => p.trim())
    .filter(Boolean)

  // Split teaching into at most two scenes so the avatar can breathe between
  // them, and so the visual gets its own scene-level focus.
  const halfIndex = Math.ceil(paragraphs.length / 2)
  const part1 = paragraphs.slice(0, halfIndex).join(' ')
  const part2 = paragraphs.slice(halfIndex).join(' ')

  scenes.push({
    index: scenes.length,
    type: 'concept',
    narration: part1,
    layout: visualBody ? 'left-panel' : 'full',
    visual: visualBody,
    visualType: lesson.visualType,
    visualLabel: lesson.visualType ? VISUAL_LABELS[lesson.visualType] : undefined,
    onScreenText: lesson.sections?.[0]?.title ?? lesson.title,
    durationSeconds: estimateDuration(part1, !!visualBody),
    transition: 'cut',
    pauseForInteraction: false,
  })

  // If there is a visual and a second teaching block, give the visual a PiP
  // scene to breathe — the teacher continues talking while it stays up.
  if (visualBody && part2) {
    scenes.push({
      index: scenes.length,
      type: 'visual',
      narration: part2,
      layout: 'pip',
      visual: visualBody,
      visualType: lesson.visualType,
      visualLabel: lesson.visualType ? VISUAL_LABELS[lesson.visualType] : undefined,
      onScreenText: lesson.visualType ? VISUAL_LABELS[lesson.visualType] : undefined,
      durationSeconds: estimateDuration(part2, true),
      transition: 'cut',
      pauseForInteraction: false,
    })
  } else if (part2) {
    scenes.push({
      index: scenes.length,
      type: 'example',
      narration: part2,
      layout: 'full',
      onScreenText: lesson.sections?.[1]?.title ?? 'Going deeper',
      durationSeconds: estimateDuration(part2, false),
      transition: 'cut',
      pauseForInteraction: false,
    })
  }

  // ── Scene: Key-point summary ───────────────────────────────────────────────
  if (lesson.keyPoints?.length) {
    const summaryNarration = `Let me summarise the key ideas. ${lesson.keyPoints.join('. ')}.`
    scenes.push({
      index: scenes.length,
      type: 'summary',
      narration: summaryNarration,
      layout: 'full',
      onScreenText: 'Key takeaways',
      durationSeconds: estimateDuration(summaryNarration, false),
      transition: 'cut',
      pauseForInteraction: false,
    })
  }

  // ── Scenes: checkpoint questions ───────────────────────────────────────────
  // Each question gets its own scene that pauses for student interaction.
  // The lesson flow only surfaces the first question here; the classroom drives
  // the adaptive difficulty selection after the student answers.
  const firstQuestion = questionPool[0]
  if (firstQuestion) {
    const questionNarration = firstQuestion.teacherPrompt
      ? `${firstQuestion.teacherPrompt} Here is the question: ${firstQuestion.prompt}`
      : firstQuestion.prompt

    const qVisualBody = stripFence(firstQuestion.visualPayload)

    scenes.push({
      index: scenes.length,
      type: 'question',
      narration: questionNarration,
      layout: qVisualBody ? 'left-panel' : 'full',
      visual: qVisualBody,
      onScreenText: 'Check your understanding',
      durationSeconds: estimateDuration(questionNarration, !!qVisualBody),
      transition: 'cut',
      // This is the pause point — the classroom takes over here.
      pauseForInteraction: true,
      questionIndex: 0,
    })
  }

  // ── Scene: Completion ──────────────────────────────────────────────────────
  const completionNarration = lesson.completionMessage
  scenes.push({
    index: scenes.length,
    type: 'completion',
    narration: completionNarration,
    layout: 'full',
    onScreenText: lesson.nextTopicSuggestion
      ? `Up next: ${lesson.nextTopicSuggestion}`
      : 'Great work',
    durationSeconds: estimateDuration(completionNarration, false),
    transition: 'cut',
    pauseForInteraction: false,
  })

  const totalDurationSeconds = scenes.reduce((sum, s) => sum + s.durationSeconds, 0)

  return {
    lessonId: lesson.id,
    lessonTitle: lesson.title,
    language,
    scenes,
    totalDurationSeconds,
  }
}
