/**
 * Shared types for the video generation pipeline.
 *
 * These are separate from ScenePlan (which is a planning concern) and from
 * did-provider (which is a provider concern) so the components and API routes
 * can import them without pulling in provider-specific code.
 */

// ─── Generation job ───────────────────────────────────────────────────────────

/**
 * State of the overall video generation job.
 *
 * - 'idle'         — No job started yet
 * - 'planning'     — Scene plan is being built from the lesson
 * - 'generating'   — D-ID clips are being created
 * - 'polling'      — Waiting for clips to finish rendering
 * - 'ready'        — All clips are available
 * - 'error'        — Generation failed
 */
export type VideoJobState =
  | 'idle'
  | 'planning'
  | 'generating'
  | 'polling'
  | 'ready'
  | 'error'

/** Per-scene clip in the job. */
export interface VideoClip {
  sceneIndex: number
  sceneType: string
  narration: string
  /** D-ID clip/talk ID. */
  clipId: string
  /** 'created' | 'started' | 'done' | 'error' */
  clipStatus: string
  /** CDN video URL, present when clipStatus === 'done'. */
  videoUrl?: string
  /** Error message, present when clipStatus === 'error'. */
  error?: string
  /** Whether this scene should pause for student interaction. */
  pauseForInteraction: boolean
  /** Question index if this is a question scene. */
  questionIndex?: number
}

/** The full video job as returned by the API and tracked in state. */
export interface VideoJob {
  lessonId: string
  state: VideoJobState
  clips: VideoClip[]
  /** Human-readable status message for the UI. */
  statusMessage: string
  /** 0–100 progress percentage. */
  progress: number
  /** Error message when state === 'error'. */
  error?: string
}

// ─── API request/response shapes ──────────────────────────────────────────────

/** POST /api/teacher/generate-video */
export interface GenerateVideoRequest {
  lessonId: string
  language: string
  /** Serialised AILesson — sent from the client so we don't need a DB round-trip. */
  lesson: unknown
}

/** GET /api/teacher/video-status?lessonId=... */
export interface VideoStatusResponse {
  job: VideoJob | null
  error?: string
}
