/**
 * PDF Parser — extracts text per-page, preserving page numbers as structure.
 *
 * Uses pdf-parse v2's `PDFParse` class, which returns page-wise text directly
 * (`TextResult.pages`). Each page becomes a ParsedSection, enabling page-level
 * chunk metadata.
 *
 * Page titles are derived from the first meaningful line of each page
 * (often the heading or section title printed at the top).
 */

import { PDFParse } from 'pdf-parse'
import type { DocumentParser } from './base-parser'
import type { ParsedDocument, ParsedSection, SupportedFormat } from '../types'
import { cleanRawText, removePdfNoise } from '../cleaner'

export class PdfParser implements DocumentParser {
  readonly supportedExtensions = ['.pdf']
  readonly formatName = 'PDF'

  async parse(
    buffer: Buffer,
    filename: string,
    format: SupportedFormat,
  ): Promise<ParsedDocument> {
    const pageTexts: string[] = []
    let totalPages = 0
    /** Whole-document text, used if per-page extraction yields nothing usable. */
    let documentText = ''

    // PDFParse holds a pdfjs document open, so it must always be destroyed.
    const parser = new PDFParse({ data: new Uint8Array(buffer) })

    try {
      const result = await parser.getText()
      totalPages = result.total
      documentText = result.text ?? ''

      // `pages` is ordered; keep positions so page numbers stay accurate even
      // when a page yields no extractable text (scans, image-only pages).
      for (const page of result.pages) {
        pageTexts[page.num - 1] = page.text ?? ''
      }
      for (let i = 0; i < totalPages; i++) {
        pageTexts[i] ??= ''
      }
    } catch (err) {
      throw new Error(`PDF parsing failed for "${filename}": ${String(err)}`)
    } finally {
      await parser.destroy().catch(() => {})
    }

    // ── Build sections (one per page) ────────────────────────────────────────
    const sections: ParsedSection[] = []

    for (let i = 0; i < pageTexts.length; i++) {
      const raw = pageTexts[i] ?? ''
      const cleaned = removePdfNoise(cleanRawText(raw))

      // Skip blank pages
      if (!cleaned || cleaned.split(/\s+/).length < 5) continue

      // Extract candidate heading: first non-empty line of the page
      const lines = cleaned.split('\n').map((l) => l.trim()).filter(Boolean)
      const candidateTitle = lines[0] ?? undefined

      // Treat the first line as a title only if it's reasonably short (heading-like)
      const title =
        candidateTitle && candidateTitle.length <= 120 && lines.length > 1
          ? candidateTitle
          : undefined

      // Content is everything (we keep the title line in the body too)
      const content = cleaned

      sections.push({
        title,
        pageNumber: i + 1,
        content,
        sectionIndex: sections.length,
      })
    }

    // Every page was blank or too short (common with scanned PDFs) — fall back
    // to the whole-document text rather than returning nothing.
    if (sections.length === 0) {
      const cleaned = removePdfNoise(cleanRawText(documentText))
      if (cleaned) {
        sections.push({
          content: cleaned,
          sectionIndex: 0,
        })
      }
    }

    const fullText = sections.map((s) => s.content).join('\n\n')

    return {
      filename,
      sourceType: format,
      sections,
      totalPages,
      fullText,
    }
  }
}
