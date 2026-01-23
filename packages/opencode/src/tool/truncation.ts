import fs from "fs/promises"
import fsSync from "fs"
import path from "path"
import { Global } from "../global"
import { Identifier } from "../id/id"
import { PermissionNext } from "../permission/next"
import type { Agent } from "../agent/agent"
import { Scheduler } from "../scheduler"
import { Log } from "../util/log"

const log = Log.create({ service: "truncation" })

export interface StreamingOutputOptions {
  threshold?: number
  /** Optional regex to filter output lines. Matching lines are collected separately. */
  filter?: RegExp
}

/**
 * Streaming output accumulator that spills to disk when threshold is exceeded.
 * Avoids O(n²) memory growth from string concatenation.
 *
 * Optionally supports line filtering - when a filter regex is provided, matching
 * lines are collected separately while full output still streams to file.
 */
export class StreamingOutput {
  private output = ""
  private outputBytes = 0
  private streamFile: { fd: number; path: string } | undefined
  private streamedBytes = 0
  private threshold: number
  private filter?: RegExp
  private filtered = ""
  private filteredBytes = 0
  private filteredCount = 0
  private lineBuffer = ""

  constructor(options: StreamingOutputOptions = {}) {
    this.threshold = options.threshold ?? Truncate.MAX_BYTES
    this.filter = options.filter
  }

  /** Append a chunk of output. Returns the current preview string. */
  append(chunk: Buffer): string {
    const text = chunk.toString()
    this.outputBytes += chunk.length

    // Spill to file when threshold exceeded
    if (!this.streamFile && this.outputBytes > this.threshold) {
      this.streamFile = this.createStreamFile()
    }

    if (this.streamFile) {
      fsSync.writeSync(this.streamFile.fd, text)
      this.streamedBytes += Buffer.byteLength(text, "utf-8")
    } else {
      this.output += text
    }

    // Process filter if active
    if (this.filter) {
      this.lineBuffer += text
      const lines = this.lineBuffer.split("\n")
      this.lineBuffer = lines.pop() || ""
      for (const line of lines) {
        if (this.filter.test(line)) {
          const entry = line + "\n"
          this.filtered += entry
          this.filteredBytes += Buffer.byteLength(entry, "utf-8")
          this.filteredCount++
        }
      }
    }

    return this.preview()
  }

  /** Get current preview - either full output, streaming indicator, or filter status */
  preview(): string {
    if (this.filter) {
      if (this.filtered) return this.filtered
      return `[filtering: ${this.outputBytes} bytes, ${this.matchCount} matches...]\n`
    }
    if (this.streamFile) {
      return `[streaming to file: ${this.streamedBytes} bytes written...]\n`
    }
    return this.output
  }

  /** Whether output was streamed to file */
  get truncated(): boolean {
    return this.streamFile !== undefined
  }

  /** Total bytes written */
  get totalBytes(): number {
    return this.streamFile ? this.streamedBytes : this.outputBytes
  }

  /** Path to output file (if streaming) */
  get outputPath(): string | undefined {
    return this.streamFile?.path
  }

  /** Get the in-memory output (only valid if not truncated) */
  get inMemoryOutput(): string {
    return this.output
  }

  /** Get filtered output (only when filter is active) */
  get filteredOutput(): string {
    return this.filtered
  }

  /** Number of lines matching the filter */
  get matchCount(): number {
    return this.filteredCount
  }

  /** Bytes omitted by filtering */
  get omittedBytes(): number {
    return this.totalBytes - this.filteredBytes
  }

  /** Whether a filter is active */
  get hasFilter(): boolean {
    return this.filter !== undefined
  }

  /** Close the stream file if open. Call this after command completes. */
  close(): void {
    // Process any remaining content in line buffer
    if (this.filter && this.lineBuffer) {
      if (this.filter.test(this.lineBuffer)) {
        const entry = this.lineBuffer + "\n"
        this.filtered += entry
        this.filteredBytes += Buffer.byteLength(entry, "utf-8")
        this.filteredCount++
      }
    }
    if (this.streamFile) {
      fsSync.closeSync(this.streamFile.fd)
    }
  }

  /** Append metadata to output (either in memory or to file) */
  appendMetadata(text: string): void {
    if (this.streamFile) {
      fsSync.appendFileSync(this.streamFile.path, text)
    } else {
      this.output += text
    }
  }

  /** Get final output string (for non-truncated) or hint message (for truncated) */
  finalize(filterPattern?: string): string {
    if (this.filter) {
      if (this.streamFile) {
        return `Filtered ${this.matchCount} matching lines from ${this.totalBytes} bytes of output.\nFull output saved to: ${this.streamFile.path}\nUse Grep to search or Read with offset/limit to view specific sections.\nNote: This file will be deleted after a few more commands. Copy it if you need to preserve it.`
      }
      return this.filtered || `[no matches for filter: ${filterPattern}]`
    }
    if (this.streamFile) {
      return `The command output was ${this.streamedBytes} bytes and was truncated (inline limit: ${this.threshold} bytes).\nFull output saved to: ${this.streamFile.path}\nUse Grep to search the full content or Read with offset/limit to view specific sections.\nNote: This file will be deleted after a few more commands. Copy it if you need to preserve it.`
    }
    return this.output
  }

  private createStreamFile(): { fd: number; path: string } | undefined {
    let fd: number = -1
    try {
      const dir = Truncate.DIR
      fsSync.mkdirSync(dir, { recursive: true })
      Truncate.cleanup().catch(() => {})
      const filepath = path.join(dir, Identifier.ascending("tool"))
      fd = fsSync.openSync(filepath, "w")
      // Write existing buffered output to file
      if (this.output) {
        fsSync.writeSync(fd, this.output)
        this.streamedBytes += Buffer.byteLength(this.output, "utf-8")
      }
      this.output = "" // Clear memory buffer
      return { fd, path: filepath }
    } catch (e) {
      if (fd >= 0) fsSync.closeSync(fd)
      log.warn("failed to create stream file, continuing in memory", { error: e })
      return undefined
    }
  }
}

export namespace Truncate {
  export const MAX_LINES = 2000
  export const MAX_BYTES = 50 * 1024
  export const DIR = path.join(Global.Path.data, "tool-output")
  export const GLOB = path.join(DIR, "*")
  const RETENTION_MS = 7 * 24 * 60 * 60 * 1000 // 7 days
  const HOUR_MS = 60 * 60 * 1000

  export type Result = { content: string; truncated: false } | { content: string; truncated: true; outputPath: string }

  export interface Options {
    maxLines?: number
    maxBytes?: number
    direction?: "head" | "tail"
  }

  export function init() {
    Scheduler.register({
      id: "tool.truncation.cleanup",
      interval: HOUR_MS,
      run: cleanup,
      scope: "global",
    })
  }

  export async function cleanup() {
    const cutoff = Identifier.timestamp(Identifier.create("tool", false, Date.now() - RETENTION_MS))
    const glob = new Bun.Glob("tool_*")
    const entries = await Array.fromAsync(glob.scan({ cwd: DIR, onlyFiles: true })).catch(() => [] as string[])
    for (const entry of entries) {
      if (Identifier.timestamp(entry) >= cutoff) continue
      await fs.unlink(path.join(DIR, entry)).catch(() => {})
    }
  }

  function hasTaskTool(agent?: Agent.Info): boolean {
    if (!agent?.permission) return false
    const rule = PermissionNext.evaluate("task", "*", agent.permission)
    return rule.action !== "deny"
  }

  export async function output(text: string, options: Options = {}, agent?: Agent.Info): Promise<Result> {
    const maxLines = options.maxLines ?? MAX_LINES
    const maxBytes = options.maxBytes ?? MAX_BYTES
    const direction = options.direction ?? "head"
    const lines = text.split("\n")
    const totalBytes = Buffer.byteLength(text, "utf-8")

    if (lines.length <= maxLines && totalBytes <= maxBytes) {
      return { content: text, truncated: false }
    }

    const out: string[] = []
    let i = 0
    let bytes = 0
    let hitBytes = false

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
    } else {
      for (i = lines.length - 1; i >= 0 && out.length < maxLines; i--) {
        const size = Buffer.byteLength(lines[i], "utf-8") + (out.length > 0 ? 1 : 0)
        if (bytes + size > maxBytes) {
          hitBytes = true
          break
        }
        out.unshift(lines[i])
        bytes += size
      }
    }

    const removed = hitBytes ? totalBytes - bytes : lines.length - out.length
    const unit = hitBytes ? "bytes" : "lines"
    const preview = out.join("\n")

    const id = Identifier.ascending("tool")
    const filepath = path.join(DIR, id)
    await Bun.write(Bun.file(filepath), text)

    const hint = hasTaskTool(agent)
      ? `The tool call succeeded but the output was truncated. Full output saved to: ${filepath}\nUse the Task tool to have explore agent process this file with Grep and Read (with offset/limit). Do NOT read the full file yourself - delegate to save context.`
      : `The tool call succeeded but the output was truncated. Full output saved to: ${filepath}\nUse Grep to search the full content or Read with offset/limit to view specific sections.`
    const message =
      direction === "head"
        ? `${preview}\n\n...${removed} ${unit} truncated...\n\n${hint}`
        : `...${removed} ${unit} truncated...\n\n${hint}\n\n${preview}`

    return { content: message, truncated: true, outputPath: filepath }
  }
}
