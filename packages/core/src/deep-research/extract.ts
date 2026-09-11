export * as ExtractLayer from "./extract"

import type { Evidence, FetchedPage } from "./types"
import { hostnameOf } from "./types"

// ------------------------------------------------------------------
// Passage extraction
// ------------------------------------------------------------------

interface HeadingSection {
  heading: string
  body: string
}

function splitIntoSections(markdown: string): HeadingSection[] {
  const sections: HeadingSection[] = []
  let currentHeading = ""
  let buffer = ""
  for (const line of markdown.split("\n")) {
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/)
    if (headingMatch) {
      if (buffer.trim()) sections.push({ heading: currentHeading, body: buffer.trim() })
      currentHeading = headingMatch[2].trim()
      buffer = ""
    } else {
      buffer += line + "\n"
    }
  }
  if (buffer.trim()) sections.push({ heading: currentHeading, body: buffer.trim() })
  return sections
}

const CODE_BLOCK_RE = /^(```[\s\S]*?^```)/gm
const TABLE_RE = /^\|.+\|$/gm
const URL_RE = /https?:\/\/[^\s)>]+/g
const NUMBER_RE = /\b\d[\d,]*\.?\d*\b/g
const CVE_RE = /\bCVE-\d{4}-\d{4,7}\b/gi
const CWE_RE = /\bCWE-\d{1,4}\b/gi
const VERSION_RE = /\b[vV]?\d+\.\d+(\.\d+)?(-[a-zA-Z0-9.]+)?\b/g

function extractClaims(body: string): string[] {
  const claims: string[] = []
  const sentences = body
    .replace(/\n+/g, ". ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 30 && s.length < 500)

  for (const sentence of sentences) {
    const signals = [
      CVE_RE.test(sentence),
      NUMBER_RE.test(sentence),
      /\b(dispatch|allowed|patched|fixed|affected|exploit|vulnerability|allowed|critical|high|medium|low|remote|local)\b/i.test(sentence),
    ]
    if (signals.some(Boolean)) claims.push(sentence)
  }
  return [...new Set(claims)].slice(0, 5)
}

function extractCodeBlocks(body: string): string[] {
  const blocks: string[] = []
  let match: RegExpExecArray | null
  const regex = new RegExp(CODE_BLOCK_RE.source, "gm")
  while ((match = regex.exec(body)) !== null) {
    blocks.push(match[0].trim())
  }
  return blocks
}

function extractTables(body: string): string[] {
  const lines = body.split("\n")
  const tables: string[] = []
  let buffer = ""
  for (const line of lines) {
    if (TABLE_RE.test(line)) {
      buffer += line + "\n"
    } else if (buffer) {
      if (buffer.split("\n").length >= 3) tables.push(buffer.trim())
      buffer = ""
    }
  }
  if (buffer.split("\n").length >= 3) tables.push(buffer.trim())
  return tables
}

function extractReferences(body: string): string[] {
  return [...new Set(body.match(URL_RE) ?? [])].filter((url) => {
    try {
      const u = new URL(url)
      return u.protocol === "http:" || u.protocol === "https:"
    } catch {
      return false
    }
  })
}

// ------------------------------------------------------------------
// Public API
// ------------------------------------------------------------------

export interface ExtractedEvidence {
  sourceURL: string
  sourceIndex: number
  heading: string
  passage: string
  claims: string[]
  code: string[]
  tables: string[]
  references: string[]
  freshness?: string
}

export function extractEvidence(page: FetchedPage, sourceIndex: number): ExtractedEvidence[] {
  const sections = splitIntoSections(page.markdown)
  const evidence: ExtractedEvidence[] = []

  for (const section of sections) {
    if (section.body.length < 40) continue
    const claims = extractClaims(section.body)
    const code = extractCodeBlocks(section.body)
    const tables = extractTables(section.body)
    if (claims.length === 0 && code.length === 0 && tables.length && section.body.length < 100) continue
    evidence.push({
      sourceURL: page.url,
      sourceIndex,
      heading: section.heading || page.title || hostnameOf(page.url),
      passage: section.body.slice(0, 2000),
      claims,
      code,
      tables,
      references: extractReferences(section.body),
    })
  }

  if (evidence.length === 0 && page.markdown.length > 50) {
    evidence.push({
      sourceURL: page.url,
      sourceIndex,
      heading: page.title || hostnameOf(page.url),
      passage: page.markdown.slice(0, 2000),
      claims: extractClaims(page.markdown),
      code: extractCodeBlocks(page.markdown),
      tables: extractTables(page.markdown),
      references: extractReferences(page.markdown),
    })
  }

  return evidence
}

export function extractEvidenceBatch(
  pages: FetchedPage[],
  startIndex: number = 0,
): ExtractedEvidence[] {
  return pages.flatMap((page, idx) => extractEvidence(page, startIndex + idx))
}

// ------------------------------------------------------------------
// Cross-source reference resolution
// ------------------------------------------------------------------

export function resolveCrossReferences(evidence: ExtractedEvidence[]): string[] {
  const allRefs = new Set<string>()
  for (const item of evidence) for (const ref of item.references) allRefs.add(ref)
  return [...allRefs].filter((url) => !evidence.some((e) => e.sourceURL === url))
}