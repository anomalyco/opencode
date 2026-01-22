import fs from "fs"
import path from "path"
import { Identifier } from "../id/id"
import { Truncate } from "../tool/truncation"
import { Log } from "./log"

const log = Log.create({ service: "output" })

/**
 * Handles streaming command output with automatic file spillover when threshold is exceeded.
 * Avoids O(n²) memory usage from repeated string concatenation by:
 * 1. Accumulating in memory up to a threshold
 * 2. Streaming to a temp file once threshold is exceeded
 */
export namespace Output {
  export const THRESHOLD = Truncate.MAX_BYTES
  export const MAX_PREVIEW = 30_000

  export interface StreamFile {
    fd: number
    path: string
  }

  export interface State {
    /** In-memory buffer (only used when not streaming to file) */
    buffer: string
    /** Total bytes received */
    bytes: number
    /** Total lines received */
    lines: number
    /** File handle when streaming to disk */
    file?: StreamFile
    /** Bytes written to file */
    written: number
  }

  export interface Result {
    /** The output content (full if not truncated, preview + hint if truncated) */
    output: string
    /** Preview for UI display (always fits in memory) */
    preview: string
    /** Whether output was truncated/streamed to file */
    truncated: boolean
    /** Path to file if output was streamed */
    path?: string
    /** Total bytes of output */
    bytes: number
    /** Total lines of output */
    lines: number
  }

  export function create(): State {
    return {
      buffer: "",
      bytes: 0,
      lines: 0,
      written: 0,
    }
  }

  function createFile(state: State): StreamFile | undefined {
    let fd: number | undefined
    try {
      const dir = Truncate.DIR
      fs.mkdirSync(dir, { recursive: true })
      Truncate.cleanup().catch(() => {})
      const filepath = path.join(dir, Identifier.ascending("tool"))
      fd = fs.openSync(filepath, "w")
      if (state.buffer) {
        fs.writeSync(fd, state.buffer)
        state.written += Buffer.byteLength(state.buffer, "utf-8")
      }
      state.buffer = ""
      return { fd, path: filepath }
    } catch (e) {
      if (fd !== undefined) fs.closeSync(fd)
      log.warn("failed to create stream file, continuing in memory", { error: e })
      return undefined
    }
  }

  export function append(state: State, chunk: Buffer | string): void {
    const text = typeof chunk === "string" ? chunk : chunk.toString()
    const size = typeof chunk === "string" ? Buffer.byteLength(chunk, "utf-8") : chunk.length

    state.bytes += size
    state.lines += (text.match(/\n/g) || []).length

    if (!state.file && (state.bytes > THRESHOLD || state.lines > Truncate.MAX_LINES)) {
      state.file = createFile(state)
    }

    if (state.file) {
      fs.writeSync(state.file.fd, text)
      state.written += Buffer.byteLength(text, "utf-8")
    } else {
      state.buffer += text
    }
  }

  export function preview(state: State): string {
    if (state.file) {
      return `[streaming to file: ${state.written} bytes written...]\n`
    }
    if (state.buffer.length > MAX_PREVIEW) {
      return state.buffer.slice(0, MAX_PREVIEW) + "\n\n..."
    }
    return state.buffer
  }

  export function close(state: State): void {
    if (state.file) {
      fs.closeSync(state.file.fd)
    }
  }

  export function cleanup(state: State): void {
    if (state.file) {
      try {
        fs.unlinkSync(state.file.path)
      } catch {}
    }
  }

  export function appendMetadata(state: State, metadata: string): void {
    if (state.file) {
      fs.appendFileSync(state.file.path, metadata)
    } else {
      state.buffer += metadata
    }
  }

  export function finalize(state: State, options?: { hint?: string }): Result {
    const truncated = !!state.file
    const filepath = state.file?.path

    if (truncated && filepath) {
      const hint =
        options?.hint ??
        `The command output was ${state.written} bytes and was truncated (inline limit: ${THRESHOLD} bytes).\nFull output saved to: ${filepath}\nUse Grep to search the full content or Read with offset/limit to view specific sections.`
      return {
        output: hint,
        preview: `[output streamed to file: ${state.written} bytes]`,
        truncated: true,
        path: filepath,
        bytes: state.bytes,
        lines: state.lines,
      }
    }

    return {
      output: state.buffer,
      preview: state.buffer.length > MAX_PREVIEW ? state.buffer.slice(0, MAX_PREVIEW) + "\n\n..." : state.buffer,
      truncated: false,
      bytes: state.bytes,
      lines: state.lines,
    }
  }
}
