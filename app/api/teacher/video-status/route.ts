/**
 * POST /api/teacher/video-status
 *
 * Polls D-ID for the current status of each clip in a VideoJob.
 * The client sends its current job state, and this route refreshes each clip
 * that hasn't finished yet.
 *
 * Using POST (not GET with query params) because we send the full clip list,
 * which is too large for a URL.
 *
 * Request:  { job: VideoJob }
 * Response: { job: VideoJob } — with updated clipStatus / videoUrl fields
 */

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getDIDClipStatus } from '@/lib/video/did-provider'
import type { VideoJob, VideoClip } from '@/lib/video/types'

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
      { error: 'DID_API_KEY not configured.' },
      { status: 503 },
    )
  }

  // ── Parse body ──────────────────────────────────────────────────────────────
  let body: { job: VideoJob }
  try {
    body = (await req.json()) as { job: VideoJob }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { job } = body
  if (!job || !Array.isArray(job.clips)) {
    return NextResponse.json({ error: 'Missing job' }, { status: 400 })
  }

  // ── Poll only pending clips ─────────────────────────────────────────────────
  const pending = job.clips.filter(
    (c) => c.clipStatus === 'created' || c.clipStatus === 'started',
  )

  const polled = await Promise.allSettled(
    pending.map(async (clip) => {
      const status = await getDIDClipStatus({ apiKey: didApiKey, clipId: clip.clipId })
      return { clip, status }
    }),
  )

  // Merge results back into the clip list.
  const updatedClips: VideoClip[] = job.clips.map((clip) => {
    // If this clip was polled, use the fresh result.
    const polledResult = polled.find(
      (r) =>
        r.status === 'fulfilled' && r.value.clip.clipId === clip.clipId,
    )
    if (polledResult && polledResult.status === 'fulfilled') {
      const { status } = polledResult.value
      return {
        ...clip,
        clipStatus: status.status,
        videoUrl: status.resultUrl ?? clip.videoUrl,
        error: status.error,
      }
    }
    return clip
  })

  // ── Derive overall job state ────────────────────────────────────────────────
  const doneCount = updatedClips.filter((c) => c.clipStatus === 'done').length
  const errorCount = updatedClips.filter((c) => c.clipStatus === 'error').length
  const totalCount = updatedClips.length

  const allDone = doneCount === totalCount
  const allFailed = errorCount === totalCount

  const progress = Math.round(((doneCount + errorCount * 0.5) / totalCount) * 100)

  let state: VideoJob['state'] = 'polling'
  let statusMessage = `Processing ${doneCount}/${totalCount} scenes…`

  if (allFailed) {
    state = 'error'
    statusMessage = 'All scenes failed to render. Check your D-ID credits.'
  } else if (allDone) {
    state = 'ready'
    statusMessage = 'Video ready'
  } else if (doneCount > 0) {
    statusMessage = `${doneCount} of ${totalCount} scenes ready…`
  }

  const updatedJob: VideoJob = {
    ...job,
    state,
    clips: updatedClips,
    statusMessage,
    progress: Math.max(job.progress, progress),
  }

  return NextResponse.json({ job: updatedJob }, { status: 200 })
}
