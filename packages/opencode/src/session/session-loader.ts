import path from "path"
import { Storage } from "../storage/storage"
import { Log } from "../util/log"
import { Snapshot } from "../snapshot"

/**
 * Session loader utilities for efficiently reading session metadata.
 * Optimizes for large session lists by using batching and selective file reading.
 */

const log = Log.create({ service: "session-loader" })

/**
 * Lightweight diff metadata for session list views.
 * Excludes heavy 'before' and 'after' text content.
 */
export type DiffMetadata = {
  file: string
  additions: number
  deletions: number
}

/**
 * Type definition for Session.Info to avoid circular dependencies.
 * This should match the Info type from session/index.ts, but with
 * summary.diffs containing only metadata (no before/after text).
 */
export type SessionInfo = {
  id: string
  projectID: string
  directory: string
  parentID?: string
  summary?: {
    diffs: DiffMetadata[]
  }
  share?: {
    url: string
  }
  title: string
  version: string
  time: {
    created: number
    updated: number
    compacting?: number
  }
  revert?: {
    messageID: string
    partID?: string
    snapshot?: string
    diff?: string
  }
}

/**
 * Configuration constants for session listing
 */
export const LIST_CONFIG = {
  BATCH_SIZE: 10, // Number of sessions to read concurrently
  MAX_READ_SIZE: 100 * 1024, // 100KB - size threshold for metadata extraction
} as const

/**
 * Metadata field patterns for regex extraction from large session files
 */
const METADATA_PATTERNS = {
  id: /"id"\s*:\s*"([^"]+)"/,
  title: /"title"\s*:\s*"([^"]+)"/,
  version: /"version"\s*:\s*"([^"]+)"/,
  projectID: /"projectID"\s*:\s*"([^"]+)"/,
  directory: /"directory"\s*:\s*"([^"]+)"/,
  parentID: /"parentID"\s*:\s*"([^"]+)"/,
  time: /"time"\s*:\s*\{[^}]*"created"\s*:\s*(\d+)[^}]*"updated"\s*:\s*(\d+)/,
  summary: /"summary"\s*:\s*\{[^}]*"diffs"\s*:\s*(\[[^\]]*\])/,
} as const

/**
 * Strips heavy 'before' and 'after' fields from diff objects,
 * keeping only metadata (file, additions, deletions).
 */
function stripDiffContent(diffs: any[] | undefined): DiffMetadata[] {
  if (!diffs || diffs.length === 0) return []

  return diffs.map((diff) => ({
    file: diff.file,
    additions: diff.additions ?? 0,
    deletions: diff.deletions ?? 0,
  }))
}

/**
 * Extracts session metadata from a JSON chunk using regex patterns.
 * Used for large files to avoid parsing the entire file.
 * Attempts to extract summary.diffs metadata if present in the chunk.
 */
function extractMetadataFromChunk(
  chunk: string,
  projectID: string,
): Partial<SessionInfo> | null {
  const idMatch = chunk.match(METADATA_PATTERNS.id)
  const titleMatch = chunk.match(METADATA_PATTERNS.title)
  const timeMatch = chunk.match(METADATA_PATTERNS.time)

  // Require essential fields
  if (!idMatch || !titleMatch || !timeMatch) {
    return null
  }

  const versionMatch = chunk.match(METADATA_PATTERNS.version)
  const projectIDMatch = chunk.match(METADATA_PATTERNS.projectID)
  const directoryMatch = chunk.match(METADATA_PATTERNS.directory)
  const parentIDMatch = chunk.match(METADATA_PATTERNS.parentID)

  // Try to extract summary diffs metadata if available in chunk
  let summary: { diffs: DiffMetadata[] } | undefined
  try {
    // Look for summary section - try to find the complete diffs array
    const summaryMatch = chunk.match(/"summary"\s*:\s*\{[^}]*"diffs"\s*:\s*(\[[\s\S]*?\])\s*\}/)
    if (summaryMatch) {
      const diffsJson = summaryMatch[1]
      const parsedDiffs = JSON.parse(diffsJson)
      const strippedDiffs = stripDiffContent(parsedDiffs)
      if (strippedDiffs.length > 0) {
        summary = { diffs: strippedDiffs }
      }
    }
  } catch (e) {
    // If summary extraction fails, continue without it
    log.debug("Could not extract summary from chunk", { error: e })
  }

  return {
    id: idMatch[1],
    title: titleMatch[1],
    version: versionMatch?.[1] || "unknown",
    projectID: projectIDMatch?.[1] || projectID,
    directory: directoryMatch?.[1] || "",
    parentID: parentIDMatch?.[1],
    time: {
      created: parseInt(timeMatch[1], 10),
      updated: parseInt(timeMatch[2], 10),
    },
    summary,
  }
}

/**
 * Reads session metadata from a small file by parsing the entire JSON.
 * Strips heavy 'before' and 'after' fields from summary.diffs to optimize memory.
 */
async function readSmallSessionFile(
  file: ReturnType<typeof Bun.file>,
): Promise<SessionInfo> {
  const data = (await file.json()) as any

  // Strip before/after content from summary.diffs if present
  let summary: { diffs: DiffMetadata[] } | undefined
  if (data.summary?.diffs) {
    const strippedDiffs = stripDiffContent(data.summary.diffs)
    if (strippedDiffs.length > 0) {
      summary = { diffs: strippedDiffs }
    }
  }

  return {
    ...data,
    summary,
  }
}

/**
 * Reads session metadata from a large file by extracting only the first chunk.
 * Falls back to full JSON parsing if metadata extraction fails.
 */
async function readLargeSessionFile(
  file: ReturnType<typeof Bun.file>,
  projectID: string,
): Promise<SessionInfo> {
  const chunk = await file.slice(0, LIST_CONFIG.MAX_READ_SIZE).text()
  const metadata = extractMetadataFromChunk(chunk, projectID)

  if (metadata && metadata.id && metadata.title && metadata.time) {
    return metadata as SessionInfo
  }

  // Fallback to full parse if metadata extraction failed
  return readSmallSessionFile(file)
}

/**
 * Reads a single session file and extracts its metadata.
 * Automatically chooses the optimal strategy based on file size.
 */
export async function readSessionMetadata(
  item: string[],
  projectID: string,
): Promise<SessionInfo | null> {
  try {
    const dir = await Storage.getDir()
    const target = path.join(dir, ...item) + ".json"
    const file = Bun.file(target)

    if (file.size <= LIST_CONFIG.MAX_READ_SIZE) {
      return await readSmallSessionFile(file)
    }

    return await readLargeSessionFile(file, projectID)
  } catch (e) {
    log.error("Failed to read session", { item, error: e })
    return null
  }
}

/**
 * Reads a batch of session files concurrently.
 */
export async function readSessionBatch(
  items: string[][],
  projectID: string,
): Promise<SessionInfo[]> {
  const results = await Promise.all(
    items.map((item) => readSessionMetadata(item, projectID)),
  )
  return results.filter((session): session is SessionInfo => session !== null)
}
