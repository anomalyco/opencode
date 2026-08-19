export * as NotebookAttach from "./attach"

import { basename, dirname, resolve, sep } from "path"
import { Context, Effect, Layer } from "effect"
import { makeLocationNode } from "../effect/app-node"
import { Config } from "../config"
import { FSUtil } from "../fs-util"
import { Location } from "../location"
import { itemFreshness, loadNotebook, notebookPathFor } from "./store"
import type { ToolOutput } from "@opencode-ai/llm"

const SESSION_CAP = 40
const NOTE_LIMIT = 700
const NOTE_MARKER = `## Local notebook`
const ATTACH_TOOLS = new Set(["read", "edit", "write", "apply_patch"])

export interface Interface {
  readonly noteFor: (sessionID: string, tool: string, args: unknown) => Effect.Effect<string>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/NotebookAttach") {}

const normalizeRel = (value: string): string => {
  const cleaned = value.trim().replaceAll("\\", "/").replace(/^\.\//, "")
  if (!cleaned || cleaned.startsWith("/") || /^[A-Za-z]:/.test(cleaned)) return ""
  const parts = cleaned.split("/")
  return parts.some((part) => part === "..") ? "" : parts.join("/")
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const fileRel = (args: unknown): string => {
  if (!isRecord(args)) return ""
  if (typeof args.filePath === "string" && args.filePath.trim()) return normalizeRel(args.filePath)
  if (Array.isArray(args.files)) {
    for (const file of args.files.filter(isRecord)) {
      const p = typeof file.filePath === "string" ? file.filePath : file.relativePath
      if (typeof p === "string" && p.trim()) return normalizeRel(p)
    }
  }
  return ""
}

const resolved = (root: string, rel: string): boolean => {
  const abs = resolve(root, rel)
  return abs === resolve(root) || abs.startsWith(resolve(root) + sep)
}

const badge = (freshness: string): string =>
  freshness === "fresh" ? "✓" : freshness === "suspect" ? "⚠ suspect" : "✗ stale"

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const location = yield* Location.Service
    const config = yield* Config.Service
    const root = location.project.directory
    // Opt-out knob: `experimental.notebook.attach = false` disables the
    // mid-task note prepending (notes_get/notes_commit and the digest still work).
    const attachEnabled = Config.latest(yield* config.entries(), "experimental")?.notebook?.attach ?? true

    // Per-session set of files already surfaced a note for, so each file is
    // attached at most once per session (its first touch).
    let seen = new Map<string, Set<string>>()
    const seenFor = (sessionID: string): Set<string> => {
      if (seen.size >= SESSION_CAP) {
        const first = seen.keys().next().value
        if (first) seen.delete(first)
      }
      let entry = seen.get(sessionID)
      if (!entry) {
        entry = new Set<string>()
        seen.set(sessionID, entry)
      }
      return entry
    }

    const note = (sessionID: string, tool: string, input: unknown): Effect.Effect<string> => {
      if (!attachEnabled || !ATTACH_TOOLS.has(tool)) return Effect.succeed("")
      const rel = fileRel(input)
      if (!rel || !resolved(root, rel) || seenFor(sessionID).has(rel)) return Effect.succeed("")
      return Effect.gen(function* () {
        const folder = dirname(rel)
        const name = basename(rel)
        const notebook = yield* loadNotebook(fs, notebookPathFor(root, folder), folder)
        const entry = notebook.entries[name]
        if (!entry) return ""
        seenFor(sessionID).add(rel)
        const freshness = yield* itemFreshness(fs, root, entry.based_on)
        const confidence = entry.confidence === "observed" ? "" : ` · ${entry.confidence}`
        return `${NOTE_MARKER} · ${rel} [${badge(freshness)}]${confidence}\n${entry.summary}\n\n_Memory is a hint, not ground truth — trust the file you are working on over this note._`.slice(0, NOTE_LIMIT)
      }).pipe(Effect.catch(() => Effect.succeed("")))
    }

    return Service.of({ noteFor: note })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [FSUtil.node, Location.node, Config.node],
})

/** Prepend a note to a tool's model-visible text, preserving a single-text result type. */
export function prependNote(output: ToolOutput, note: string): ToolOutput {
  if (!note) return output
  if (output.content.length === 1 && output.content[0]?.type === "text")
    return { ...output, content: [{ type: "text", text: `${note}\n\n${output.content[0].text}` }] }
  return { ...output, content: [{ type: "text", text: note }, ...output.content] }
}
