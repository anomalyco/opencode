import path from "path"
import fs from "fs/promises"
import { ulid } from "ulid"
import { Global } from "../global"

export namespace Truncate {
  export const MAX_LINES = 2000
  export const MAX_BYTES = 50 * 1024
  export const MAX_PERSIST_BYTES = 10 * 1024 * 1024 // 10MB hard limit for persisted files
  export const PREVIEW_HEAD_LINES = 100
  export const PREVIEW_TAIL_LINES = 50

  export interface Result {
    content: string
    truncated: boolean
    filePath?: string
  }

  export interface Options {
    maxLines?: number
    maxBytes?: number
    direction?: "head" | "tail"
  }

  export interface PersistOptions extends Options {
    sessionID: string
    toolName: string
    callID?: string
  }

  function sanitizeToolName(name: string): string {
    return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 64)
  }

  function isLikelyJson(text: string): boolean {
    const trimmed = text.trimStart()
    return trimmed.startsWith("{") || trimmed.startsWith("[")
  }

  const MAX_PREVIEW_BYTES = 20 * 1024 // 20KB default max for preview content

  interface PreviewOptions {
    maxBytes?: number
    maxLines?: number
  }

  function getPreviewHeadTail(
    lines: string[],
    totalBytes: number,
    totalLines: number,
    options: PreviewOptions = {},
  ): string {
    const maxPreviewBytes = Math.min(options.maxBytes ?? MAX_PREVIEW_BYTES, MAX_PREVIEW_BYTES)
    const maxPreviewLines = options.maxLines ?? PREVIEW_HEAD_LINES + PREVIEW_TAIL_LINES

    // Calculate how many lines we can show, respecting maxLines
    const headCount = Math.min(PREVIEW_HEAD_LINES, Math.floor(maxPreviewLines * 0.67))
    const tailCount = Math.min(PREVIEW_TAIL_LINES, maxPreviewLines - headCount)

    const headLines = lines.slice(0, headCount)
    const tailLines = totalLines > headCount + tailCount ? lines.slice(-tailCount) : []
    const omittedLines = totalLines - headCount - tailLines.length

    let preview = headLines.join("\n")
    if (omittedLines > 0 && tailLines.length > 0) {
      preview += `\n\n... ${omittedLines.toLocaleString()} lines omitted (${totalBytes.toLocaleString()} bytes total) ...\n\n`
      preview += tailLines.join("\n")
    } else if (omittedLines > 0) {
      preview += `\n\n... ${omittedLines.toLocaleString()} lines omitted (${totalBytes.toLocaleString()} bytes total) ...`
    }

    // Ensure preview itself doesn't exceed byte limit (handles few-lines-but-large-bytes case)
    const previewBytes = Buffer.byteLength(preview, "utf-8")
    if (previewBytes > maxPreviewBytes) {
      const headBudget = Math.floor(maxPreviewBytes * 0.6) // 60% for head
      const tailBudget = Math.floor(maxPreviewBytes * 0.3) // 30% for tail
      const headBuf = Buffer.from(preview, "utf-8").subarray(0, headBudget)
      const tailBuf = Buffer.from(preview, "utf-8").subarray(-tailBudget)
      const truncatedHead = headBuf.toString("utf-8")
      const truncatedTail = tailBuf.toString("utf-8")
      preview = `${truncatedHead}\n\n... preview truncated (${totalBytes.toLocaleString()} bytes total) ...\n\n${truncatedTail}`
    }

    return preview
  }

  function isValidSessionID(sessionID: string): boolean {
    return /^ses_[a-zA-Z0-9_-]+$/.test(sessionID) && !sessionID.includes("..")
  }

  async function saveToFile(
    content: string,
    sessionID: string,
    toolName: string,
    callID?: string,
  ): Promise<string> {
    if (!isValidSessionID(sessionID)) {
      throw new Error(`Invalid sessionID format: ${sessionID}`)
    }

    const sanitizedName = sanitizeToolName(toolName)
    const extension = isLikelyJson(content) ? ".json" : ".txt"
    const callPart = callID ? `-${callID.slice(-8)}` : ""
    const filename = `${sanitizedName}${callPart}-${ulid()}${extension}`
    const baseDir = path.join(Global.Path.data, "storage", "tool_results")
    const dir = path.join(baseDir, sessionID)
    const filePath = path.join(dir, filename)

    const resolvedPath = path.resolve(filePath)
    const resolvedBase = path.resolve(baseDir)
    if (!resolvedPath.startsWith(resolvedBase + path.sep)) {
      throw new Error(`Path traversal detected: ${filePath}`)
    }

    await fs.mkdir(dir, { recursive: true })

    const contentBytes = Buffer.byteLength(content, "utf-8")
    let contentToSave = content
    if (contentBytes > MAX_PERSIST_BYTES) {
      const buf = Buffer.from(content, "utf-8").subarray(0, MAX_PERSIST_BYTES)
      contentToSave = buf.toString("utf-8")
    }
    await fs.writeFile(filePath, contentToSave, "utf-8")
    return filePath
  }

  export function output(text: string, options: Options = {}): Result {
    const maxLines = options.maxLines ?? MAX_LINES
    const maxBytes = options.maxBytes ?? MAX_BYTES
    const direction = options.direction ?? "head"
    const lines = text.split("\n")
    const totalBytes = Buffer.byteLength(text, "utf-8")

    if (lines.length <= maxLines && totalBytes <= maxBytes) {
      return { content: text, truncated: false }
    }

    const out: string[] = []
    var i = 0
    var bytes = 0
    var hitBytes = false

    if (direction === "head") {
      for (i = 0; i < lines.length && i < maxLines; i++) {
        const size = Buffer.byteLength(lines[i], "utf-8") + (i > 0 ? 1 : 0)
        if (bytes + size > maxBytes) {
          hitBytes = true
          break
        }
        out.push(lines[i])
        bytes += size
      }
      const removed = hitBytes ? totalBytes - bytes : lines.length - out.length
      const unit = hitBytes ? "chars" : "lines"
      return { content: `${out.join("\n")}\n\n...${removed} ${unit} truncated...`, truncated: true }
    }

    for (i = lines.length - 1; i >= 0 && out.length < maxLines; i--) {
      const size = Buffer.byteLength(lines[i], "utf-8") + (out.length > 0 ? 1 : 0)
      if (bytes + size > maxBytes) {
        hitBytes = true
        break
      }
      out.unshift(lines[i])
      bytes += size
    }
    const removed = hitBytes ? totalBytes - bytes : lines.length - out.length
    const unit = hitBytes ? "chars" : "lines"
    return { content: `...${removed} ${unit} truncated...\n\n${out.join("\n")}`, truncated: true }
  }

  export async function outputWithPersistence(
    text: string,
    options: PersistOptions,
  ): Promise<Result> {
    const maxLines = options.maxLines ?? MAX_LINES
    const maxBytes = options.maxBytes ?? MAX_BYTES
    const lines = text.split("\n")
    const totalBytes = Buffer.byteLength(text, "utf-8")

    if (lines.length <= maxLines && totalBytes <= maxBytes) {
      return { content: text, truncated: false }
    }

    const filePath = await saveToFile(text, options.sessionID, options.toolName, options.callID)
    const preview = getPreviewHeadTail(lines, totalBytes, lines.length, {
      maxBytes: maxBytes,
      maxLines: maxLines,
    })
    const isJson = isLikelyJson(text)
    const wasCapped = totalBytes > MAX_PERSIST_BYTES

    let instructions = `\n\n<truncation_notice>
WARNING: Output was truncated. The preview above is INCOMPLETE and may be missing critical data.
Full output (${totalBytes.toLocaleString()} bytes, ${lines.length.toLocaleString()} lines) saved to: ${filePath}${wasCapped ? `\nNote: Output was capped at ${MAX_PERSIST_BYTES.toLocaleString()} bytes due to size limits.` : ""}
You MUST read the file to get complete/accurate results. Use Read tool with offset/limit, Grep to search, or bash with jq for JSON.
</truncation_notice>`

    return {
      content: preview + instructions,
      truncated: true,
      filePath,
    }
  }

  export async function cleanupSessionFiles(sessionID: string): Promise<void> {
    if (!isValidSessionID(sessionID)) {
      return
    }
    const baseDir = path.join(Global.Path.data, "storage", "tool_results")
    const dir = path.join(baseDir, sessionID)
    const resolvedDir = path.resolve(dir)
    const resolvedBase = path.resolve(baseDir)
    if (!resolvedDir.startsWith(resolvedBase + path.sep)) {
      return
    }
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}
