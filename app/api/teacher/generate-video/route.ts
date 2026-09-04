/**
 * POST /api/teacher/generate-video
 *
 * Takes a generated AILesson, builds a scene plan, submits each scene to D-ID
 * as a separate clip, and returns the job state for the client to poll.
 *
 * All D-ID API calls are made server-side; the API key never reaches the browser.
 *
 * Flow:
 *   1. Build ScenePlan from lesson
 *   2. For each scene, POST to D-ID /clips
 *   3. Return initial VideoJob (all clips in 'created' state)
 *   4. Client polls /api/teacher/video-status to watch progress
 *
 * Request:  { lesson: AILesson, language: string, lessonId: string }
 * Response: { job: VideoJob } | { error: string }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { buildScenePlan } from '@/lib/video/scene-planner'
import { createDIDClip, DEFAULT_PRESENTER_ID } from '@/lib/video/did-provider'
import type { AILesson } from '@/lib/ai/types'
import type { VideoJob, VideoClip, GenerateVideoRequest } from '@/lib/video/types'

/** Maximum number of scenes to submit to D-ID in a single job. */
const MAX_SCENES_PER_JOB = 6

export async function POST(req: NextRequest) {
  // ── Auth ────────────────────────────────────────────────────────────────────
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

  // ── Check D-ID key ──────────────────────────────────────────────────────────
  const didApiKey = process.env.DID_API_KEY?.trim()
  if (!didApiKey) {
    return NextResponse.json(
      { error: 'Video generation is not configured. Add DID_API_KEY to .env.local.' },
      { status: 503 },
    )
  }

  // ── Parse body ──────────────────────────────────────────────────────────────
  let body: GenerateVideoRequest
  try {
    body = (await req.json()) as GenerateVideoRequest
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { lesson, language, lessonId } = body

  if (!lesson || !lessonId) {
    return NextResponse.json({ error: 'Missing lesson or lessonId' }, { status: 400 })
  }

  const aiLesson = lesson as AILesson

  // ── Build scene plan ────────────────────────────────────────────────────────
  const plan = buildScenePlan(aiLesson, language ?? 'English')

  // Limit the number of scenes to avoid burning too many API credits.
  const scenesToGenerate = plan.scenes.slice(0, MAX_SCENES_PER_JOB)

  console.log(
    `[generate-video] Lesson "${aiLesson.title}" → ${scenesToGenerate.length} scenes`,
  )

  // ── Submit clips to D-ID ────────────────────────────────────────────────────
  const presenterIdOverride = process.env.DID_PRESENTER_ID ?? DEFAULT_PRESENTER_ID

  const clipResults = await Promise.allSettled(
    scenesToGenerate.map(async (scene) => {
      const clip = await createDIDClip({
        apiKey: didApiKey,
        presenterIdOverride,
        script: scene.narration,
      })
      return { scene, clip }
    }),
  )

  const clips: VideoClip[] = []
  let hasError = false

  for (const result of clipResults) {
    if (result.status === 'fulfilled') {
      const { scene, clip } = result.value
      clips.push({
        sceneIndex: scene.index,
        sceneType: scene.type,
        narration: scene.narration,
        clipId: clip.id,
        clipStatus: clip.status,
        videoUrl: clip.resultUrl,
        pauseForInteraction: scene.pauseForInteraction,
        questionIndex: scene.questionIndex,
      })
    } else {
      // One failed scene shouldn't kill the entire lesson video.
      console.error('[generate-video] Scene submission failed:', result.reason)
      hasError = true
    }
  }

  if (clips.length === 0) {
    return NextResponse.json(
      { error: 'All D-ID clip submissions failed. Check DID_API_KEY and account credits.' },
      { status: 502 },
    )
  }

  const job: VideoJob = {
    lessonId,
    state: 'polling',
    clips,
    statusMessage: hasError
      ? `Generating ${clips.length} scenes (${scenesToGenerate.length - clips.length} failed to start)`
      : `Generating ${clips.length} scenes…`,
    progress: 5,
  }

  return NextResponse.json({ job }, { status: 200 })
}
