/**
 * POST /api/materials/[id]/process
 *
 * Trigger document processing for a specific material.
 * Downloads the file, parses it, chunks it, and writes structural chunks to the DB.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdmin } from '@/lib/supabase/admin'
import { processDocument } from '@/lib/ai/document-processing/processor'
import { indexDocument } from '@/lib/ai/rag/embedder'
import { getAIProvider } from '@/lib/ai/providers'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // 1. Authenticate user
  const supabase = await createSupabaseServerClient()
  if (!supabase) {
    return NextResponse.json({ error: 'Database unavailable' }, { status: 503 })
  }

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 2. Validate parameters
  const { id: materialId } = await params
  if (!materialId) {
    return NextResponse.json({ error: 'Material ID is required' }, { status: 400 })
  }

  // 3. Verify ownership before doing anything
  const { data: material, error: fetchError } = await supabase
    .from('materials')
    .select('id')
    .eq('id', materialId)
    .eq('user_id', user.id)
    .single()

  if (fetchError || !material) {
    return NextResponse.json(
      { error: 'Material not found or access denied' },
      { status: 404 }
    )
  }

  // 4. Process using Admin client (bypasses RLS to write chunks)
  let adminClient
  try {
    adminClient = createSupabaseAdmin()
  } catch (error) {
    console.error('[process-route] Failed to init admin client:', error)
    return NextResponse.json(
      { error: 'Internal server configuration error' },
      { status: 500 }
    )
  }

  try {
    const result = await processDocument(materialId, user.id, adminClient)

    if (result.status === 'failed') {
      return NextResponse.json(
        { error: 'Document processing failed', details: result.errors },
        { status: 500 }
      )
    }

    // 5. Embed the chunks. processDocument deliberately stores `embedding: null`,
    // so without this step every chunk is invisible to retrieval — the vector
    // search filters on `embedding IS NOT NULL`.
    let embeddedChunks = 0
    try {
      const provider = getAIProvider()
      embeddedChunks = await indexDocument(materialId, user.id, provider, adminClient)
    } catch (embedError) {
      const message = embedError instanceof Error ? embedError.message : String(embedError)
      console.error('[process-route] Embedding failed:', message)

      // Chunks exist but cannot be retrieved — say so rather than reporting success.
      await adminClient
        .from('materials')
        .update({
          processing_status: 'error',
          processing_errors: [...result.errors, `Embedding failed: ${message}`],
        })
        .eq('id', materialId)

      return NextResponse.json(
        { error: 'Document was parsed but could not be indexed for search', details: message },
        { status: 500 }
      )
    }

    return NextResponse.json({ result: { ...result, embeddedChunks } }, { status: 200 })
  } catch (error) {
    console.error('[process-route] Unhandled processing error:', error)
    return NextResponse.json(
      { error: 'An unexpected error occurred during processing' },
      { status: 500 }
    )
  }
}
