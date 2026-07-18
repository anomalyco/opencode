import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect, Layer, Context, Schema } from "effect"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Snapshot } from "@/snapshot"
import { Session } from "./session"
import { SessionID, MessageID } from "./schema"
import { Config } from "@/config/config"
import path from "path"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { createTwoFilesPatch, diffLines } from "diff"
import { Storage } from "@/storage/storage"
import { SessionFileChange } from "./file-change"
import * as Bom from "@/util/bom"

function unquoteGitPath(input: string) {
  if (!input.startsWith('"')) return input
  if (!input.endsWith('"')) return input
  const body = input.slice(1, -1)
  const bytes: number[] = []

  for (let i = 0; i < body.length; i++) {
    const char = body[i]!
    if (char !== "\\") {
      bytes.push(char.charCodeAt(0))
      continue
    }

    const next = body[i + 1]
    if (!next) {
      bytes.push("\\".charCodeAt(0))
      continue
    }

    if (next >= "0" && next <= "7") {
      const chunk = body.slice(i + 1, i + 4)
      const match = chunk.match(/^[0-7]{1,3}/)
      if (!match) {
        bytes.push(next.charCodeAt(0))
        i++
        continue
      }
      bytes.push(parseInt(match[0], 8))
      i += match[0].length
      continue
    }

    const escaped =
      next === "n"
        ? "\n"
        : next === "r"
          ? "\r"
          : next === "t"
            ? "\t"
            : next === "b"
              ? "\b"
              : next === "f"
                ? "\f"
                : next === "v"
                  ? "\v"
                  : next === "\\" || next === '"'
                    ? next
                    : undefined

    bytes.push((escaped ?? next).charCodeAt(0))
    i++
  }

  return Buffer.from(bytes).toString()
}

export interface Interface {
  readonly summarize: (input: { sessionID: SessionID; messageID: MessageID }) => Effect.Effect<void>
  readonly diff: (input: { sessionID: SessionID; messageID?: MessageID }) => Effect.Effect<Snapshot.FileDiff[]>
  readonly computeDiff: (input: { messages: SessionV1.WithParts[] }) => Effect.Effect<Snapshot.FileDiff[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionSummary") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const snapshot = yield* Snapshot.Service
    const config = yield* Config.Service
    const fs = yield* FSUtil.Service
    const storage = yield* Storage.Service

    const computeDiff = Effect.fn("SessionSummary.computeDiff")(function* (input: { messages: SessionV1.WithParts[] }) {
      let from: string | undefined
      let to: string | undefined
      for (const item of input.messages) {
        if (!from) {
          for (const part of item.parts) {
            if (part.type === "step-start" && part.snapshot) {
              from = part.snapshot
              break
            }
          }
        }
        for (const part of item.parts) {
          if (part.type === "step-finish" && part.snapshot) to = part.snapshot
        }
      }
      if (from && to) return yield* snapshot.diffFull(from, to)
      return []
    })

    const summarize = Effect.fn("SessionSummary.summarize")(function* (input: {
      sessionID: SessionID
      messageID: MessageID
    }) {
      if ((yield* config.get()).snapshot === false) return
      const all = yield* sessions.messages({ sessionID: input.sessionID }).pipe(Effect.orDie)
      if (!all.length) return

      const messages = all.filter(
        (m) => m.info.id === input.messageID || (m.info.role === "assistant" && m.info.parentID === input.messageID),
      )
      const target = messages.find((m) => m.info.id === input.messageID)
      if (!target || target.info.role !== "user") return
      const msgDiffs = yield* computeDiff({ messages })
      target.info.summary = { ...target.info.summary, diffs: msgDiffs }
      yield* sessions.updateMessage(target.info)
    })

    const diff = Effect.fn("SessionSummary.diff")(function* (input: { sessionID: SessionID; messageID?: MessageID }) {
      const messages = yield* sessions.messages({ sessionID: input.sessionID }).pipe(Effect.orDie)
      if (!input.messageID) {
        const directory = (yield* sessions.get(input.sessionID).pipe(Effect.orDie)).directory
        const tracked = yield* SessionFileChange.list(storage, input.sessionID)
        if (tracked.length) {
          const unique = new Map<string, SessionFileChange.Baseline>()
          for (const baseline of tracked) {
            if (!unique.has(baseline.path)) unique.set(baseline.path, baseline)
          }
          const current = yield* Effect.forEach(unique.values(), (baseline) =>
            trackedDiff(fs, baseline, directory),
          ).pipe(Effect.map((items) => items.flatMap((item) => (item ? [item] : []))))
          const paths = new Set(unique.keys())
          return [
            ...editedFiles(messages, directory).filter((item) => item.file && !paths.has(item.file)),
            ...current,
          ].toSorted((a, b) => (a.file ?? "").localeCompare(b.file ?? ""))
        }
        const snapshotDiff = (yield* config.get()).snapshot === false ? [] : yield* computeDiff({ messages })
        if (snapshotDiff.length) return snapshotDiff
        return editedFiles(messages, directory)
      }
      const message = messages.find((item) => item.info.id === input.messageID)
      if (!message || message.info.role !== "user") return []
      const diffs = message.info.summary?.diffs ?? []
      return diffs.map((item) => {
        if (item.file === undefined) return item
        const file = unquoteGitPath(item.file)
        if (file === item.file) return item
        return { ...item, file }
      })
    })

    return Service.of({ summarize, diff, computeDiff })
  }),
)

export const DiffInput = Schema.Struct({
  sessionID: SessionID,
  messageID: Schema.optional(MessageID),
})
export type DiffInput = Schema.Schema.Type<typeof DiffInput>

export const node = LayerNode.make({
  service: Service,
  layer: layer,
  deps: [Session.node, Snapshot.node, Config.node, FSUtil.node, Storage.node],
})

const trackedDiff = Effect.fnUntraced(function* (
  fs: FSUtil.Interface,
  baseline: SessionFileChange.Baseline,
  directory: string,
) {
  if (baseline.content === undefined) return
  const file = path.join(directory, baseline.path)
  const exists = yield* fs.existsSafe(file)
  const current = exists ? yield* Bom.readFile(fs, file).pipe(Effect.catch(() => Effect.succeed(undefined))) : undefined
  if (exists && current === undefined) return
  const content = current?.text ?? ""
  const bom = current?.bom ?? false
  if (baseline.existed === exists && baseline.content === content && baseline.bom === bom) return
  const changes = diffLines(baseline.content, content)
  return {
    file: baseline.path,
    patch: createTwoFilesPatch(file, file, baseline.content, content),
    additions: changes.reduce((sum, change) => sum + (change.added ? change.count : 0), 0),
    deletions: changes.reduce((sum, change) => sum + (change.removed ? change.count : 0), 0),
    status: !baseline.existed ? "added" : !exists ? "deleted" : "modified",
  } satisfies Snapshot.FileDiff
})

function editedFiles(messages: SessionV1.WithParts[], directory: string) {
  const files = new Map<string, Snapshot.FileDiff>()
  for (const part of messages.flatMap((message) => message.parts)) {
    if (part.type !== "tool" || part.state.status !== "completed") continue
    const metadata = part.state.metadata
    if (!metadata || typeof metadata !== "object") continue
    const records = Array.isArray(metadata.filediffs)
      ? metadata.filediffs
      : metadata.filediff
        ? [metadata.filediff]
        : Array.isArray(metadata.files)
          ? metadata.files
          : []
    for (const record of records) {
      if (!record || typeof record !== "object") continue
      const source = record as Record<string, unknown>
      const file = [source.file, source.filePath, source.movePath, source.relativePath].find(
        (value): value is string => typeof value === "string",
      )
      if (!file) continue
      const relative = path.isAbsolute(file) ? path.relative(directory, file).replaceAll("\\", "/") : file
      if (relative.startsWith("../") || relative === "..") continue
      const display = relative
      const previous = files.get(display)
      files.set(display, {
        file: display,
        patch: typeof source.patch === "string" ? source.patch : previous?.patch,
        additions: (previous?.additions ?? 0) + (typeof source.additions === "number" ? source.additions : 0),
        deletions: (previous?.deletions ?? 0) + (typeof source.deletions === "number" ? source.deletions : 0),
        status:
          source.status === "added" || source.type === "add"
            ? "added"
            : source.status === "deleted" || source.type === "delete"
              ? "deleted"
              : "modified",
      })
    }
  }
  return [...files.values()]
}

export * as SessionSummary from "./summary"
