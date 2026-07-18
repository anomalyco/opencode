import path from "path"
import { Effect } from "effect"
import { Storage } from "@/storage/storage"
import { SessionID } from "./schema"
import { Hash } from "@opencode-ai/core/util/hash"

export const metadataKey = "__opencode_file_baselines"
const maxBytes = 1024 * 1024

export interface Input {
  file: string
  existed: boolean
  content: string
  bom: boolean
}

export interface Baseline extends Omit<Input, "file" | "content"> {
  path: string
  content: string | undefined
}

export const persist = Effect.fn("SessionFileChange.persist")(function* (input: {
  storage: Storage.Interface
  sessionID: SessionID
  directory: string
  metadata: Record<string, unknown>
}) {
  const raw = input.metadata[metadataKey]
  const metadata = { ...input.metadata }
  delete metadata[metadataKey]
  if (!Array.isArray(raw)) return metadata

  const baselines = raw.flatMap((item): Baseline[] => {
    if (!item || typeof item !== "object") return []
    const record = item as Record<string, unknown>
    if (
      typeof record.file !== "string" ||
      typeof record.existed !== "boolean" ||
      typeof record.content !== "string" ||
      typeof record.bom !== "boolean"
    ) {
      return []
    }
    const relative = path.relative(input.directory, record.file).replaceAll("\\", "/")
    if (!relative || relative === ".." || relative.startsWith("../")) return []
    return [
      {
        path: relative,
        existed: record.existed,
        content: Buffer.byteLength(record.content) <= maxBytes ? record.content : undefined,
        bom: record.bom,
      },
    ]
  })
  yield* Effect.forEach(baselines, (baseline) => {
    const key = ["session_file", input.sessionID, Hash.fast(baseline.path)]
    return input.storage.read<Baseline>(key).pipe(
      Effect.catch(() => input.storage.write(key, baseline).pipe(Effect.orDie, Effect.as(baseline))),
      Effect.ignore,
    )
  })
  return metadata
})

export const list = Effect.fn("SessionFileChange.list")(function* (storage: Storage.Interface, sessionID: SessionID) {
  const keys = yield* storage.list(["session_file", sessionID]).pipe(Effect.orDie)
  return yield* Effect.forEach(keys, (key) => storage.read<Baseline>(key).pipe(Effect.orDie), {
    concurrency: "unbounded",
  })
})

export * as SessionFileChange from "./file-change"
