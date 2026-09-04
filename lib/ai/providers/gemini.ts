import {
  GoogleGenerativeAI,
  type GenerationConfig,
  type Content,
} from '@google/generative-ai'
import type { AIProvider, GenerateOptions } from './types'

/**
 * Gemini implementation of AIProvider.
 *
 * Generation runs through a fallback chain rather than a single model. Free-tier
 * quota is granted per model per day (quotaId
 * `GenerateRequestsPerDayPerProjectPerModel-FreeTier`), and current-generation
 * models get very small allowances — gemini-3.6-flash is 20 requests/day. When
 * one model's daily quota is spent, the next in the chain has an untouched one,
 * so a day of building does not end with a dead app.
 *
 * Set GEMINI_MODEL in .env.local to control which model is tried first.
 */

const CONFIGURED_MODEL = process.env.GEMINI_MODEL ?? 'gemini-3.5-flash'

/** Tried in order. Verified callable on the free tier; lite models last. */
const MODEL_CHAIN = [
  CONFIGURED_MODEL,
  'gemini-3.5-flash',
  'gemini-flash-latest',
  'gemini-3.7-flash',
  'gemini-3.5-flash-lite',
  'gemini-flash-lite-latest',
].filter((m, i, all) => all.indexOf(m) === i)

const EMBEDDING_MODEL = 'gemini-embedding-001'

/**
 * Must match the `vector(768)` column and the `match_material_chunks(...)`
 * signature in supabase/migrations/20260902_rag_embeddings.sql.
 * gemini-embedding-001 returns 3072 dimensions unless this is requested.
 */
const EMBEDDING_DIMENSIONS = 768

/** A spent daily quota, or a model this key may not call — both mean "try the next model". */
function isDailyQuotaError(message: string): boolean {
  return (
    /PerDay|RequestsPerDay/i.test(message) ||
    /no longer available to new users/i.test(message)
  )
}

export class GeminiProvider implements AIProvider {
  readonly name = 'gemini'

  private readonly client: GoogleGenerativeAI
  private readonly apiKey: string

  constructor(apiKey: string) {
    this.client = new GoogleGenerativeAI(apiKey)
    this.apiKey = apiKey
  }

  // ─── Transient-failure handling ───────────────────────────────────────────

  /**
   * Gemini returns 503 ("model is currently experiencing high demand") and 429
   * (rate limit) under load. Both are temporary and usually clear within a few
   * seconds, so retry with exponential backoff rather than failing the lesson.
   */
  private async withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
    const delays = [1000, 3000, 7000]
    let lastError: unknown

    for (let attempt = 0; attempt <= delays.length; attempt++) {
      try {
        return await fn()
      } catch (err) {
        lastError = err
        const message = err instanceof Error ? err.message : String(err)

        // A per-day quota does not clear on a retry — surface it so the caller
        // can move to the next model in the chain instead of waiting.
        if (isDailyQuotaError(message)) break

        const transient =
          /\b(429|500|502|503|504)\b/.test(message) ||
          /high demand|overloaded|unavailable|rate limit|try again later/i.test(message)

        if (!transient || attempt === delays.length) break

        const wait = delays[attempt]!
        console.warn(
          `[gemini] ${label} hit a transient error (attempt ${attempt + 1}/${delays.length + 1}), ` +
            `retrying in ${wait}ms.`,
        )
        await new Promise((r) => setTimeout(r, wait))
      }
    }

    throw lastError
  }

  /**
   * Runs `call` against each model in MODEL_CHAIN until one succeeds.
   * Only daily-quota and access errors advance to the next model; a genuine
   * failure (bad prompt, malformed request) throws from the first model rather
   * than being retried five more times.
   */
  private async withModelChain<T>(
    label: string,
    call: (modelName: string) => Promise<T>,
  ): Promise<T> {
    let lastError: unknown

    for (let i = 0; i < MODEL_CHAIN.length; i++) {
      const modelName = MODEL_CHAIN[i]!
      try {
        return await this.withRetry(`${label}:${modelName}`, () => call(modelName))
      } catch (err) {
        lastError = err
        const message = err instanceof Error ? err.message : String(err)

        if (!isDailyQuotaError(message) || i === MODEL_CHAIN.length - 1) throw err

        console.warn(
          `[gemini] ${modelName} is out of daily free-tier quota — ` +
            `falling back to ${MODEL_CHAIN[i + 1]}.`,
        )
      }
    }

    throw lastError
  }

  // ─── Text generation ──────────────────────────────────────────────────────

  async generateText(
    systemPrompt: string,
    userPrompt: string,
    options?: GenerateOptions,
  ): Promise<string> {
    const generationConfig: GenerationConfig = {
      temperature: options?.temperature ?? 0.7,
      maxOutputTokens: options?.maxTokens,
    }

    const contents: Content[] = [
      { role: 'user', parts: [{ text: userPrompt }] },
    ]

    const result = await this.withModelChain('generateText', (modelName) =>
      this.client.getGenerativeModel({ model: modelName }).generateContent({
        systemInstruction: systemPrompt,
        contents,
        generationConfig,
      }),
    )

    return result.response.text()
  }

  // ─── JSON generation ──────────────────────────────────────────────────────

  async generateJSON<T>(
    systemPrompt: string,
    userPrompt: string,
    options?: GenerateOptions,
  ): Promise<T> {
    const generationConfig: GenerationConfig = {
      temperature: options?.temperature ?? 0.2, // lower temp = more reliable JSON
      maxOutputTokens: options?.maxTokens,
      responseMimeType: 'application/json',
    }

    const contents: Content[] = [
      { role: 'user', parts: [{ text: userPrompt }] },
    ]

    const result = await this.withModelChain('generateJSON', (modelName) =>
      this.client.getGenerativeModel({ model: modelName }).generateContent({
        systemInstruction: systemPrompt,
        contents,
        generationConfig,
      }),
    )

    const raw = result.response.text().trim()

    // Strip markdown code fences if the model wraps JSON in them
    const cleaned = raw.startsWith('```')
      ? raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
      : raw

    return JSON.parse(cleaned) as T
  }

  // ─── Embeddings ───────────────────────────────────────────────────────────

  /**
   * Called over REST rather than through the SDK: @google/generative-ai 0.24.1
   * has no `outputDimensionality` parameter, and without it this model returns
   * 3072-dim vectors that the vector(768) column rejects.
   */
  async embed(text: string): Promise<number[]> {
    const json = await this.withRetry('embed', async () => {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:embedContent?key=${this.apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: `models/${EMBEDDING_MODEL}`,
            content: { parts: [{ text }] },
            outputDimensionality: EMBEDDING_DIMENSIONS,
          }),
        },
      )

      if (!res.ok) {
        throw new Error(
          `Embedding request failed (HTTP ${res.status}): ${(await res.text()).slice(0, 200)}`,
        )
      }

      return (await res.json()) as { embedding?: { values?: number[] } }
    })

    const values = json.embedding?.values

    if (!values || values.length !== EMBEDDING_DIMENSIONS) {
      throw new Error(
        `Expected ${EMBEDDING_DIMENSIONS} dimensions, got ${values?.length ?? 0}. ` +
          `The vector column and match_material_chunks() both assume ${EMBEDDING_DIMENSIONS}.`,
      )
    }

    return values
  }

  /**
   * Embeds many chunks per HTTP request via `batchEmbedContents`.
   *
   * A textbook produces hundreds of chunks. One request each would exceed the
   * free tier's per-minute request limit long before the document finished
   * indexing, so batching here is what makes document upload usable at all.
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return []

    const BATCH_SIZE = 100
    const results: number[][] = []

    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE)

      const json = await this.withRetry(`embedBatch[${i}]`, async () => {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:batchEmbedContents?key=${this.apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              requests: batch.map((text) => ({
                model: `models/${EMBEDDING_MODEL}`,
                content: { parts: [{ text }] },
                outputDimensionality: EMBEDDING_DIMENSIONS,
              })),
            }),
          },
        )

        if (!res.ok) {
          throw new Error(
            `Batch embedding failed (HTTP ${res.status}): ${(await res.text()).slice(0, 200)}`,
          )
        }

        return (await res.json()) as { embeddings?: Array<{ values?: number[] }> }
      })

      const embeddings = json.embeddings ?? []

      if (embeddings.length !== batch.length) {
        throw new Error(
          `Batch embedding returned ${embeddings.length} vectors for ${batch.length} chunks.`,
        )
      }

      for (const item of embeddings) {
        const values = item.values
        if (!values || values.length !== EMBEDDING_DIMENSIONS) {
          throw new Error(
            `Expected ${EMBEDDING_DIMENSIONS} dimensions, got ${values?.length ?? 0}.`,
          )
        }
        results.push(values)
      }

      console.log(
        `[gemini] Embedded ${Math.min(i + BATCH_SIZE, texts.length)}/${texts.length} chunks`,
      )
    }

    return results
  }
}
