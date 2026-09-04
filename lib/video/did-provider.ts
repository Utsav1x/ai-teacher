/**
 * D-ID Avatar Video Provider
 *
 * Wraps D-ID's REST API for generating photorealistic talking-head clips.
 *
 * Two product lines are used here:
 *   - /talks  (V2 Photo Avatar): any image URL → talking-head video
 *   - /clips  (V3 Pro Avatar): pre-built professional presenter avatars
 *
 * We use /clips because:
 *   1. Pre-built presenters are already professional, photorealistic humans.
 *   2. No need to host our own avatar image.
 *   3. The API is simpler (just a presenter_id + script).
 *
 * All calls are server-side only. The API key never leaves the Node.js runtime.
 *
 * D-ID API reference: https://docs.d-id.com/reference/createclip
 */

const DID_API_BASE = 'https://api.d-id.com'

/** Default presenter — professional female educational presenter. */
export const DEFAULT_PRESENTER_ID = 'v2_public_Amber@0zSz8kflCN'

/** Max characters D-ID accepts per script. */
const MAX_SCRIPT_CHARS = 1500

export type DIDClipStatus = 'created' | 'started' | 'done' | 'error'

export interface DIDClipJob {
  /** D-ID clip ID */
  id: string
  status: DIDClipStatus
  /** Present when status === 'done'. Signed CDN URL. */
  resultUrl?: string
  /** Present when status === 'error'. */
  error?: string
}

/**
 * Build Basic auth header from the D-ID API key.
 * D-ID expects the key as Basic base64(key:).
 */
function didAuthHeader(apiKey: string): string {
  const encoded =
    typeof Buffer !== 'undefined'
      ? Buffer.from(`${apiKey}:`).toString('base64')
      : btoa(`${apiKey}:`)
  return `Basic ${encoded}`
}

/**
 * POST /clips — Submits a clip for rendering.
 *
 * D-ID generates the video asynchronously. This returns immediately with a
 * clip ID that you poll with getClipStatus().
 */
export async function createDIDClip(params: {
  apiKey: string
  presenterIdOverride?: string
  script: string
  /** Optional: preferred voice. If omitted D-ID uses the presenter's default voice. */
  voiceId?: string
}): Promise<DIDClipJob> {
  const { apiKey, presenterIdOverride, script, voiceId } = params

  const presenterId = presenterIdOverride ?? DEFAULT_PRESENTER_ID

  // Truncate to avoid 400 from D-ID.
  const safeScript = script.slice(0, MAX_SCRIPT_CHARS)

  const body: Record<string, unknown> = {
    presenter_id: presenterId,
    script: {
      type: 'text',
      input: safeScript,
      ...(voiceId ? { provider: { type: 'microsoft', voice_id: voiceId } } : {}),
    },
    config: {
      // Stitch face to background cleanly.
      result_format: 'mp4',
    },
  }

  const res = await fetch(`${DID_API_BASE}/clips`, {
    method: 'POST',
    headers: {
      Authorization: didAuthHeader(apiKey),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`D-ID createClip failed (${res.status}): ${text.slice(0, 200)}`)
  }

  const data = (await res.json()) as { id?: string; status?: string; result_url?: string }

  if (!data.id) {
    throw new Error(`D-ID returned no clip id. Body: ${JSON.stringify(data).slice(0, 200)}`)
  }

  return {
    id: data.id,
    status: (data.status as DIDClipStatus) ?? 'created',
    resultUrl: data.result_url,
  }
}

/**
 * GET /clips/{id} — Poll a clip for its current status.
 */
export async function getDIDClipStatus(params: {
  apiKey: string
  clipId: string
}): Promise<DIDClipJob> {
  const { apiKey, clipId } = params

  const res = await fetch(`${DID_API_BASE}/clips/${encodeURIComponent(clipId)}`, {
    headers: {
      Authorization: didAuthHeader(apiKey),
      Accept: 'application/json',
    },
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`D-ID getClip failed (${res.status}): ${text.slice(0, 200)}`)
  }

  const data = (await res.json()) as {
    id?: string
    status?: string
    result_url?: string
    error?: { description?: string; code?: string }
  }

  const status = (data.status as DIDClipStatus) ?? 'created'
  const errorMsg = data.error
    ? (data.error.description ?? data.error.code ?? 'Unknown D-ID error')
    : undefined

  return {
    id: clipId,
    status,
    resultUrl: data.result_url,
    error: errorMsg,
  }
}

/**
 * GET /clips/presenters — List available V3 Pro Avatar presenters.
 * Useful for letting the user or admin choose a different presenter later.
 */
export async function listDIDPresenters(apiKey: string): Promise<Array<{
  id: string
  name: string
  gender?: string
  thumbnail?: string
}>> {
  const res = await fetch(`${DID_API_BASE}/clips/presenters`, {
    headers: {
      Authorization: didAuthHeader(apiKey),
      Accept: 'application/json',
    },
  })

  if (!res.ok) return []

  const data = (await res.json()) as {
    presenters?: Array<{
      presenter_id?: string
      name?: string
      gender?: string
      thumbnail_url?: string
    }>
  }

  return (data.presenters ?? []).map((p) => ({
    id: p.presenter_id ?? '',
    name: p.name ?? '',
    gender: p.gender,
    thumbnail: p.thumbnail_url,
  }))
}

/**
 * Alternative: POST /talks — Photo avatar from a custom image URL.
 * Kept here as a fallback or for custom avatar scenarios.
 */
export async function createDIDTalk(params: {
  apiKey: string
  /** Publicly accessible image URL (face photo). */
  sourceImageUrl: string
  script: string
}): Promise<DIDClipJob> {
  const { apiKey, sourceImageUrl, script } = params

  const safeScript = script.slice(0, MAX_SCRIPT_CHARS)

  const body = {
    source_url: sourceImageUrl,
    script: {
      type: 'text',
      input: safeScript,
      provider: { type: 'microsoft', voice_id: 'en-US-JennyNeural' },
    },
    config: { result_format: 'mp4' },
  }

  const res = await fetch(`${DID_API_BASE}/talks`, {
    method: 'POST',
    headers: {
      Authorization: didAuthHeader(apiKey),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`D-ID createTalk failed (${res.status}): ${text.slice(0, 200)}`)
  }

  const data = (await res.json()) as { id?: string; status?: string }

  if (!data.id) {
    throw new Error(`D-ID returned no talk id. Body: ${JSON.stringify(data).slice(0, 200)}`)
  }

  return {
    id: data.id,
    status: (data.status as DIDClipStatus) ?? 'created',
  }
}

/**
 * GET /talks/{id} — Poll a talk for status.
 */
export async function getDIDTalkStatus(params: {
  apiKey: string
  talkId: string
}): Promise<DIDClipJob> {
  const { apiKey, talkId } = params

  const res = await fetch(`${DID_API_BASE}/talks/${encodeURIComponent(talkId)}`, {
    headers: {
      Authorization: didAuthHeader(apiKey),
      Accept: 'application/json',
    },
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`D-ID getTalk failed (${res.status}): ${text.slice(0, 200)}`)
  }

  const data = (await res.json()) as {
    id?: string
    status?: string
    result_url?: string
    error?: { description?: string; code?: string }
  }

  return {
    id: talkId,
    status: (data.status as DIDClipStatus) ?? 'created',
    resultUrl: data.result_url,
    error: data.error?.description ?? data.error?.code,
  }
}
