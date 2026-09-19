export * as InteractiveSpool from "./spool"

import path from "path"
import { appendFile as fsAppendFile, open as fsOpen } from "node:fs/promises"
import { Context, Effect, Layer, Schema } from "effect"
import { Config } from "../../config"
import { FSUtil } from "../../fs-util"
import { Global } from "../../global"
import { makeLocationNode } from "../../effect/app-node"
import { ToolOutputStore } from "../../tool-output-store"
import type { ID } from "./job"
import { DEFAULT_MAX_SPOOL_BYTES } from "./job"

/**
 * One bounded read from the spool between two byte offsets (spec R25).
 * `text` is the decoded chunk bounded by the `tool_output.max_lines` /
 * `max_bytes` limits; `truncated` marks that this read hit the cap, or that
 * the cursor sits past bytes elided by an earlier cap or the spool cap and
 * this read delivered none of them — elided bytes are NOT re-delivered later,
 * callers advance to `nextCursor` and page the spool file (via the `read`
 * tool) instead; `nextCursor` is the absolute end offset after this read
 * (monotonic delivery cursor, spec I6).
 */
export interface Chunk {
  readonly text: string
  readonly truncated: boolean
  readonly nextCursor: number
}

/**
 * Spool manager (spec R24). Every job continuously appends its combined
 * output to ONE managed file `<data>/tool-output/tool_ijob_<id>` — the
 * ToolOutputStore directory and naming prefix, so the existing 7-day
 * retention applies — capped at `interactive.max_spool_bytes` (default
 * 8 MiB); past the cap `append` stops storing bytes and reports `capped`.
 * The `outputPath` of every interactive result names this file. Spools are
 * never deleted by the manager; retention is ToolOutputStore's.
 */
export interface Interface {
  /**
   * Create (or re-attach to) the managed spool file for a job and return its
   * absolute path. Called once per job by the job store before the child
   * spawns; the path goes into every result's `outputPath`.
   */
  readonly open: (jobID: ID) => Effect.Effect<string, StorageError>
  /**
   * Append bytes to the job's spool. Returns how many bytes were actually
   * stored (0 past the cap), whether the cap has been reached (sticky), and
   * the spool's total stored size in bytes.
   */
  readonly append: (
    jobID: ID,
    bytes: Uint8Array,
  ) => Effect.Effect<{ bytesStored: number; capped: boolean; totalBytes: number }, StorageError>
  /**
   * Read the stored range `[from, to)` as UTF-8 text bounded by the
   * `tool_output` limits (spec R25). `to === undefined` reads to the current
   * end. UB if `from` exceeds the stored size.
   */
  readonly slice: (
    jobID: ID,
    from: number,
    to: number | undefined,
    limits: { maxLines: number; maxBytes: number },
  ) => Effect.Effect<Chunk, StorageError>
}

export class StorageError extends Schema.TaggedErrorClass<StorageError>()("InteractiveSpool.StorageError", {
  operation: Schema.Literals(["open", "append", "slice"]),
  cause: Schema.Defect(),
}) {
  override get message() {
    const detail = this.cause instanceof Error ? this.cause.message : String(this.cause)
    return `Failed to ${this.operation} interactive spool${detail ? `: ${detail}` : ""}`
  }
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/InteractiveSpool") {}

interface Entry {
  readonly path: string
  size: number
  capped: boolean
  /** Set when a slice cut or the spool cap elided bytes (spec R25/I5). */
  elided: boolean
}

const takePrefix = (text: string, maximumBytes: number) => {
  let bytes = 0
  let content = ""
  for (const char of text) {
    const size = Buffer.byteLength(char, "utf8")
    if (bytes + size > maximumBytes) break
    content += char
    bytes += size
  }
  return content
}

const capChunk = (text: string, limits: { maxLines: number; maxBytes: number }) => {
  const lines = text.split("\n")
  let cut = false
  let output = text
  if (lines.length > limits.maxLines) {
    output = lines.slice(0, limits.maxLines).join("\n")
    cut = true
  }
  if (Buffer.byteLength(output, "utf8") > limits.maxBytes) {
    output = takePrefix(output, limits.maxBytes)
    cut = true
  }
  return { text: output, cut }
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const global = yield* Global.Service
    const config = yield* Config.Service
    // the ToolOutputStore managed directory, so its 7-day retention applies (spec R24)
    const directory = path.join(global.data, ToolOutputStore.MANAGED_DIRECTORY)
    const spools = new Map<string, Entry>()

    const requireSpool = (jobID: ID) => {
      const entry = spools.get(jobID)
      if (!entry) throw new StorageError({ operation: "open", cause: new Error(`No spool opened for ${jobID}`) })
      return entry
    }

    const capBytes = Effect.fn("InteractiveSpool.capBytes")(function* () {
      const entries = yield* config.entries().pipe(Effect.catch(() => Effect.succeed([] as Config.Entry[])))
      return Config.latest(entries, "interactive")?.max_spool_bytes ?? DEFAULT_MAX_SPOOL_BYTES
    })

    const storage = (operation: "open" | "append" | "slice") => (cause: unknown) => new StorageError({ operation, cause })

    const open = Effect.fn("InteractiveSpool.open")(function* (jobID: ID) {
      yield* fs.ensureDir(directory).pipe(Effect.mapError(storage("open")))
      const file = path.join(directory, `tool_${jobID}`)
      if (yield* fs.existsSafe(file)) {
        // re-attach after an in-process restart of the manager adopts the stored size
        const info = yield* fs.stat(file).pipe(Effect.mapError(storage("open")))
        spools.set(jobID, { path: file, size: Number(info.size), capped: false, elided: false })
        return file
      }
      yield* fs.writeFileString(file, "", { flag: "wx" }).pipe(Effect.mapError(storage("open")))
      spools.set(jobID, { path: file, size: 0, capped: false, elided: false })
      return file
    })

    const append = Effect.fn("InteractiveSpool.append")(function* (jobID: ID, bytes: Uint8Array) {
      const entry = requireSpool(jobID)
      const cap = yield* capBytes()
      if (entry.capped || entry.size >= cap) {
        entry.capped = true
        entry.elided = true
        return { bytesStored: 0, capped: true, totalBytes: entry.size }
      }
      const stored = Math.min(bytes.length, cap - entry.size)
      if (stored > 0) {
        const view = stored === bytes.length ? bytes : bytes.subarray(0, stored)
        // plain appendFile keeps the per-chunk hot path cheap; the Effect
        // FileSystem scoped-open costs more than the append itself
        yield* Effect.tryPromise({
          try: () => fsAppendFile(entry.path, view),
          catch: storage("append"),
        })
        entry.size += stored
        entry.capped = entry.size >= cap
        if (entry.capped) entry.elided = true
      }
      return { bytesStored: stored, capped: entry.capped, totalBytes: entry.size }
    })

    const readRange = Effect.fn("InteractiveSpool.readRange")(function* (file: string, offset: number, length: number) {
      return yield* Effect.tryPromise({
        try: async () => {
          const handle = await fsOpen(file, "r")
          try {
            const buffer = new Uint8Array(length)
            const read = await handle.read(buffer, 0, length, offset)
            return read.bytesRead === length ? buffer : buffer.subarray(0, read.bytesRead)
          } finally {
            await handle.close()
          }
        },
        catch: storage("slice"),
      })
    })

    const slice = Effect.fn("InteractiveSpool.slice")(function* (
      jobID: ID,
      from: number,
      to: number | undefined,
      limits: { maxLines: number; maxBytes: number },
    ) {
      const entry = requireSpool(jobID)
      const end = Math.min(to ?? entry.size, entry.size)
      const length = Math.max(0, end - from)
      const text = length > 0 ? new TextDecoder().decode(yield* readRange(entry.path, from, length)) : ""
      const capped = capChunk(text, limits)
      if (capped.cut) entry.elided = true
      return {
        text: capped.text,
        // true for a real cut here, or when this empty read's cursor sits past
        // bytes an earlier cut or the spool cap elided — never inferred from
        // the cursor position alone (spec R25/I5)
        truncated: capped.cut || (entry.elided && capped.text === ""),
        nextCursor: end,
      }
    })

    return Service.of({ open, append, slice })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [Global.node, Config.node, FSUtil.node] })
