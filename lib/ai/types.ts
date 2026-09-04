/**
 * Shared TypeScript types for the AI teaching system.
 *
 * These types are intentionally separate from `lib/teacher-engine.ts`
 * (which owns the classroom UI contract) so the AI layer can evolve
 * independently and be wired up later.
 */

// ─── Learner Context ──────────────────────────────────────────────────────────

export type LearnerLevel = 'Beginner' | 'Intermediate' | 'Advanced'
export type LearnerGoal =
  | 'General curiosity'
  | 'Pass an exam'
  | 'Apply at work'
  | 'Refresh memory'

export interface LearnerPreferences {
  level: LearnerLevel
  language: string       // e.g. "English", "Hindi"
  goal: LearnerGoal
  timeMinutes: number    // 10 | 20 | 40
}

// ─── Lesson Generation ────────────────────────────────────────────────────────

export interface GenerateLessonRequest {
  /** The topic the student wants to learn. */
  topic: string
  /** IDs from the `materials` table — used to scope RAG retrieval. */
  materialIds?: string[]
  /** Supabase user ID — required when materialIds is set. */
  userId?: string
  /** Learner preferences from the /start page. */
  preferences: LearnerPreferences
  /**
   * Sequence index (0-based). Affects difficulty and scope:
   * 0 = introductory, 1+ = build on previous lessons.
   */
  lessonIndex?: number
  /** Titles of previously taught lessons — for curriculum continuity. */
  previousTopics?: string[]
  /**
   * Concepts the student answered incorrectly earlier in the session. The
   * generator is told to revisit these rather than assuming they landed.
   */
  weakConcepts?: string[]
}

/**
 * How demanding a checkpoint is. The classroom moves along this scale in
 * response to the student's answers — down after a mistake, up after a
 * confident correct answer — which is what makes the lesson adaptive rather
 * than a fixed quiz.
 */
export type QuestionDifficulty = 'easy' | 'core' | 'stretch'

/**
 * The form of visual a topic calls for.
 *
 * Mathematics wants equations and worked steps; physics wants labelled
 * diagrams; history wants timelines; programming wants runnable code and its
 * output. Declaring the choice as data — rather than letting it fall out of
 * free-form text — means the UI can render each form appropriately and the
 * reasoning behind it can be shown to the learner.
 */
export type VisualType =
  | 'code'      // programming — snippet plus expected output
  | 'formula'   // mathematics, physics — equations and derivation steps
  | 'diagram'   // structures, processes, architecture, labelled parts
  | 'timeline'  // history, ordered events, sequences
  | 'table'     // comparisons, classifications, properties
  | 'graph'     // plotted relationships, trends, distributions

export const VISUAL_TYPES: VisualType[] = [
  'code',
  'formula',
  'diagram',
  'timeline',
  'table',
  'graph',
]

export interface AIQuestion {
  /** Whether it's an MCQ or open-ended question. */
  type: 'MCQ' | 'Freeform'
  prompt: string
  /** Only present if type === 'MCQ' */
  options?: string[]
  /** Only present if type === 'MCQ'. 0-3 index. */
  correctIndex?: number
  /** Only present if type === 'Freeform'. What the AI expects in a correct answer. */
  expectedAnswer?: string
  /** Why the correct answer is right. */
  explanation: string
  /** Maya's intro to the question. */
  teacherPrompt: string
  /** Optional visual for question phase. */
  visualPayload?: string
  /** Where this question sits on the difficulty scale. */
  difficulty?: QuestionDifficulty
  /**
   * The specific concept under test, in a few words. Getting this wrong marks
   * the concept weak, which steers both the rest of the lesson and the next one.
   */
  concept?: string
}

/** One step in the lesson plan sidebar. */
export interface AILessonSection {
  title: string
  type: 'Concept' | 'Example' | 'Practice' | 'Checkpoint'
  minutes: number
  description: string
}

/**
 * The full lesson object returned by the AI teacher agent.
 * Mirrors TeacherLesson from teacher-engine.ts but uses a plain string id
 * and adds AI-specific fields.
 */
export interface AILesson {
  /** AI-generated unique id for this session (UUID or slug). */
  id: string
  title: string
  subtitle: string
  /** One sentence measurable learning objective. */
  objective: string
  /** 2–3 sentence summary of the lesson (Maya speaking to student). */
  summary: string
  /** 3 key takeaways from the lesson. */
  keyPoints: string[]
  /** Maya's full teaching narrative (3–4 paragraphs). */
  teachingPrompt: string
  /**
   * Visual blackboard content — a markdown code block with code snippet,
   * ASCII diagram, formula, or table relevant to the teaching phase.
   */
  visualPayload?: string
  /**
   * Which form of visual the subject calls for. The model chooses this itself
   * from the topic, so the choice is explicit and inspectable rather than an
   * accident of whatever it happened to emit.
   */
  visualType?: VisualType
  /** One sentence on why that form suits this topic. Shown to the learner. */
  visualRationale?: string
  /** Ordered list of lesson sections for the progress panel. */
  sections: AILessonSection[]
  /**
   * The first checkpoint question. Retained so a lesson generated before
   * `questions` existed still runs.
   */
  question: AIQuestion
  /**
   * Graded checkpoints for the lesson, one per difficulty. The classroom picks
   * which to ask next from the student's running performance rather than
   * walking them in order.
   */
  questions?: AIQuestion[]
  /**
   * Re-explanation using a DIFFERENT analogy — shown when student answers wrong.
   */
  reexplanation: string
  completionMessage: string
  /** Topic suggestion for the next lesson in this session. */
  nextTopicSuggestion?: string
}

// ─── Answer Evaluation ────────────────────────────────────────────────────────

export interface EvaluateAnswerRequest {
  lessonTitle: string
  lessonObjective: string
  lessonKeyPoints: string[]
  lessonTeachingPrompt: string
  questionPrompt: string
  /** Only present if question was MCQ */
  questionOptions?: string[]
  /** Only present if question was MCQ */
  correctIndex?: number
  /** Only present if question was MCQ */
  selectedIndex?: number
  /** Only present if question was Freeform */
  expectedAnswer?: string
  /** Raw freeform answer text, if the student typed instead of selecting. */
  studentFreeformText?: string
}

export interface AIEvaluation {
  isCorrect: boolean
  /** Short, warm feedback sentence. */
  feedback: string
  /** Text of the correct answer option. */
  correctAnswer: string
  /**
   * Full re-explanation using a DIFFERENT analogy than the teaching prompt.
   * Should be 2–3 sentences.
   */
  reexplanation: string
  /** CTA button label. e.g. "Continue lesson" or "Review concept". */
  nextCta: string
  /** Optional visual for the evaluation/reexplanation phase. */
  visualPayload?: string
  /**
   * The specific misconception detected, if any.
   * Null if the answer was correct or the wrong choice was ambiguous.
   */
  misunderstandingDetected?: string | null
}

// ─── Ask Teacher (Q&A) ────────────────────────────────────────────────────────

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

export interface AskTeacherRequest {
  lessonTitle: string
  lessonObjective: string
  lessonKeyPoints: string[]
  /** Full conversation history so far. */
  conversationHistory: ChatTurn[]
  /** The user's new message. */
  userMessage: string
}

export interface AskTeacherResponse {
  answer: string
  /** 2–3 follow-up questions the student might want to ask next. */
  followUpSuggestions?: string[]
}

// ─── RAG ─────────────────────────────────────────────────────────────────────

export interface DocumentChunk {
  materialId: string
  chunkIndex: number
  content: string
  tokenCount: number
}

export interface RetrievedChunk {
  id: string
  materialId: string
  content: string
  similarity: number
}
