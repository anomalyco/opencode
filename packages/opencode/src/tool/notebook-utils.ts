/**
 * Shared utilities for notebook tool operations
 */

import * as path from "path"
import { FileTime } from "../file/time"
import { Instance } from "../project/instance"
import { Bus } from "../bus"
import { File } from "../file"
import { FileWatcher } from "../file/watcher"
import { Snapshot } from "@/snapshot"
import { parseNotebook, type Notebook } from "../notebook"
import { assertExternalDirectory } from "./external-directory"

// Constants
const DEFAULT_PREVIEW_LENGTH = 100

export interface LoadNotebookResult {
  notebook: Notebook
  content: string
  filePath: string
}

/**
 * Load and parse a notebook file
 */
export async function loadNotebook(
  params: { filePath: string },
  ctx: { sessionID: string }
): Promise<LoadNotebookResult> {
  const filePath = path.isAbsolute(params.filePath)
    ? params.filePath
    : path.join(Instance.directory, params.filePath)

  await assertExternalDirectory({ sessionID: ctx.sessionID } as any, filePath)

  const file = Bun.file(filePath)
  const stats = await file.stat().catch(() => {})
  if (!stats) throw new Error(`File not found: ${filePath}`)
  if (stats.isDirectory()) throw new Error(`Path is a directory: ${filePath}`)

  await FileTime.assert(ctx.sessionID, filePath)
  const content = await file.text()

  const result = parseNotebook(content)
  if (!result.success || !result.notebook) {
    throw new Error(`Invalid notebook: ${result.error}`)
  }

  return { notebook: result.notebook, content, filePath }
}

/**
 * Get relative path for display
 */
export function getDisplayPath(filePath: string): string {
  return path.relative(Instance.worktree, filePath)
}

/**
 * Calculate file diff
 */
export function calculateFileDiff(
  filePath: string,
  before: string,
  after: string
): Snapshot.FileDiff {
  const oldLines = before.split("\n")
  const newLines = after.split("\n")

  let additions = 0
  let deletions = 0

  for (let i = 0; i < Math.max(oldLines.length, newLines.length); i++) {
    const oldLine = oldLines[i]
    const newLine = newLines[i]
    if (oldLine !== newLine) {
      if (newLine !== undefined) additions++
      if (oldLine !== undefined) deletions++
    }
  }

  return { file: filePath, before, after, additions, deletions }
}

/**
 * Write notebook to file with locking and events
 */
export async function writeNotebook(
  filePath: string,
  contentOld: string,
  contentNew: string,
  sessionID: string
): Promise<void> {
  const file = Bun.file(filePath)

  await FileTime.withLock(filePath, async () => {
    await file.write(contentNew)
    await Bus.publish(File.Event.Edited, { file: filePath })
    await Bus.publish(FileWatcher.Event.Updated, { file: filePath, event: "change" })
    FileTime.read(sessionID, filePath)
  })
}

/**
 * Truncate content for preview
 */
export function truncatePreview(content: string, maxLength = DEFAULT_PREVIEW_LENGTH): string {
  return content.length > maxLength ? content.slice(0, maxLength) + "..." : content
}

/**
 * Slice with truncation info
 */
export function sliceWithTruncation(content: string, maxLength: number) {
  return {
    value: content.slice(0, maxLength),
    truncated: content.length > maxLength
  }
}
