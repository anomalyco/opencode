export * as NotebookTools from "./tools"

import { ToolFailure } from "@opencode-ai/llm"
import { Effect, Layer, Schema } from "effect"
import { makeLocationNode } from "../effect/app-node"
import { FSUtil } from "../fs-util"
import { Location } from "../location"
import { PermissionV2 } from "../permission"
import { ToolRegistry } from "../tool/registry"
import { Tool } from "../tool/tool"
import { Tools } from "../tool/tools"
import { allNotebooks, buildSkeleton, hydrateBasedOn, itemFreshness, loadNotebook, notebookPathFor } from "./store"
import {
  applyOps,
  relationFolder,
  relTo,
  scoreEntry,
  scoreRelation,
  serializeNotebook,
  unifiedDiff,
  NOTEBOOK_NAME,
  type BasedOn,
  type Confidence,
  type Op,
  type Notebook,
} from "./notebook"

const nameGet = "notes_get"
const nameCommit = "notes_commit"

const confidenceSchema = Schema.Union([
  Schema.Literal("observed"),
  Schema.Literal("inferred"),
  Schema.Literal("verified"),
])

const GetInput = Schema.Struct({
  task: Schema.optional(Schema.String.annotate({ description: "A task; matched against summaries across all notebooks." })),
  path: Schema.optional(Schema.String.annotate({ description: "A file/dir (project-relative); returns its ancestor-chain memory." })),
  limit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 50 }))).annotate({
    description: "Max matches (default 20).",
  }),
})

const FolderSummaryInput = Schema.Struct({
  path: Schema.String,
  summary: Schema.String,
  based_on: Schema.optional(Schema.Array(Schema.String)),
})

const EntryInput = Schema.Struct({
  path: Schema.String,
  summary: Schema.String,
  based_on: Schema.optional(Schema.Array(Schema.String)),
  confidence: Schema.optional(confidenceSchema),
})

const RelationInput = Schema.Struct({
  from: Schema.String,
  to: Schema.String,
  description: Schema.String,
  based_on: Schema.optional(Schema.Array(Schema.String)),
  confidence: Schema.optional(confidenceSchema),
})

const RemovedRel = Schema.Struct({ from: Schema.String, to: Schema.String })

const CommitInput = Schema.Struct({
  task: Schema.String,
  folder_summaries: Schema.optional(Schema.Array(FolderSummaryInput)),
  entries: Schema.optional(Schema.Array(EntryInput)),
  relations: Schema.optional(Schema.Array(RelationInput)),
  removed: Schema.optional(Schema.Struct({
    entries: Schema.optional(Schema.Array(Schema.String)),
    relations: Schema.optional(Schema.Array(RemovedRel)),
  })),
})

const Output = Schema.Struct({ text: Schema.String })
type Output = typeof Output.Type

const toModelOutput = ({ output: result }: { output: Output }) => [{ type: "text" as const, text: result.text }]

const normalizeRel = (root: string, value: string): string => {
  const cleaned = value.trim().replaceAll("\\", "/").replace(/^\.\//, "")
  if (!cleaned) return ""
  if (cleaned.startsWith("/") || /^[A-Za-z]:/.test(cleaned)) return ""
  const parts = cleaned.split("/")
  if (parts.some((part) => part === "..")) return ""
  return parts.join("/")
}

const badge = (freshness: string): string =>
  freshness === "fresh" ? "✓" : freshness === "suspect" ? "⚠ suspect" : "✗ stale"

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const fs = yield* FSUtil.Service
    const location = yield* Location.Service
    const permission = yield* PermissionV2.Service
    const root = location.project.directory

    const freshnessOf = (basedOn: BasedOn) => itemFreshness(fs, root, basedOn)

    const notesGet = Tool.make({
      description:
        "Recall the project notebook memory (`.note.yaml` per folder): folder roles, per-file summaries, and cross-file relations accumulated across tasks. Call at the START of a task, before exploring. Pass `path` to read the ancestor chain for a file/dir, or `task` to keyword-search all notebooks. Entries carry a freshness badge: ✓ fresh · ⚠ suspect (its source changed) · ✗ stale (its source is gone). This is a map to trust and navigate by, not to re-verify wholesale — re-read a file only to resolve a ⚠/✗ entry.",
      input: GetInput,
      output: Output,
      toModelOutput,
      execute: (input) =>
        Effect.gen(function* () {
          const notebooks = yield* allNotebooks(fs, root)
          const byRel = new Map(notebooks.map((nb) => [nb.rel, nb]))
          const lines: string[] = []
          const limit = input.limit ?? 20

          if (input.path) {
            const target = normalizeRel(root, input.path)
            if (!target) {
              return { text: `Invalid path: ${input.path}` } satisfies Output
            }
            const parts = target.split("/").slice(0, -1)
            const chain: string[] = []
            for (let i = 0; i <= parts.length; i++) chain.push(parts.slice(0, i).join("/"))
            const leaf = chain[chain.length - 1]
            lines.push(`## Notebook memory · ${target}`)
            let shown = 0
            for (let i = 0; i < chain.length; i++) {
              const dir = chain[i] ?? ""
              const nb = byRel.get(dir)
              if (!nb || (!nb.summary && Object.keys(nb.entries).length === 0)) continue
              const isLeaf = dir === leaf
              lines.push(`### ${dir || "."}`)
              if (nb.summary) {
                const f = yield* freshnessOf(nb.based_on)
                lines.push(`- [${badge(f)}] **folder** — ${nb.summary}`)
                shown++
              }
              if (isLeaf) {
                for (const entry of Object.values(nb.entries)) {
                  const f = yield* freshnessOf(entry.based_on)
                  lines.push(`- [${badge(f)}] **${entry.name}** — ${entry.summary}`)
                  shown++
                }
                for (const rel of nb.relations) {
                  const f = yield* freshnessOf(rel.based_on)
                  lines.push(`- [${badge(f)}] **rel ${rel.from} → ${rel.to}** — ${rel.description}`)
                  shown++
                }
              } else {
                const child = chain[i + 1]?.split("/").pop() ?? ""
                const descent = child ? nb.entries[child] : undefined
                if (descent) {
                  const f = yield* freshnessOf(descent.based_on)
                  lines.push(`- [${badge(f)}] **${child}/** — ${descent.summary}`)
                  shown++
                }
              }
            }
            if (shown === 0) lines.push("_No memory on this path yet — explore with read/grep and commit what you learn._")
          }

          if (input.task) {
            lines.push("", `## Matches for "${input.task}"`)
            const entryHits = scoredEntries(notebooks, input.task, limit)
            const relHits = scoredRelations(notebooks, input.task, limit)
            if (entryHits.length === 0 && relHits.length === 0) lines.push("_Nothing relevant in the notebooks for this yet._")
            for (const hit of entryHits) {
              const f = yield* freshnessOf(hit.basedOn)
              lines.push(`- [${badge(f)}] \`${hit.nb.rel || "."}\` · **${hit.name}** — ${hit.summary}`)
            }
            for (const hit of relHits) {
              const f = yield* freshnessOf(hit.basedOn)
              lines.push(`- [${badge(f)}] \`${hit.nb.rel || "."}\` · **rel ${hit.rel.from} → ${hit.rel.to}** — ${hit.rel.description}`)
            }
          }

          lines.push("", "### Repo skeleton")
          const skeleton = yield* buildSkeleton(fs, root)
          if (skeleton.length === 0) lines.push("_no top-level source directories_")
          else for (const entry of skeleton) {
            const sample = entry.sample.length > 0 ? ` · e.g. ${entry.sample.join(", ")}` : ""
            lines.push(`- \`${entry.rel}/\` (${entry.dirs} dirs, ${entry.files} files)${sample}`)
          }
          lines.push("", "Notebook entries are hints, not ground truth — trust the code when a note and what you observe contradict.")

          return { text: lines.join("\n") } satisfies Output
        }).pipe(
          Effect.mapError((error) => new ToolFailure({ message: error instanceof Error ? error.message : String(error) })),
        ),
    })

    const notesCommit = Tool.make({
      description:
        "Persist what a task learned into the per-folder notebooks (`.note.yaml`), the way a senior engineer's mental model accumulates. Call when a task produced durable understanding — including explaining code or answering a question. Three kinds of knowledge:\n- `folder_summaries`: the role of a whole subtree (abstract; the higher the folder, the more abstract).\n- `entries`: knowledge about ONE file/dir, stored in the notebook of its direct parent.\n- `relations`: a connection between two files/dirs, stored at their lowest common ancestor.\nPass REWRITTEN compact summaries (fold prior summaries in), one paragraph each; skip line-level detail. Requires user approval (a diff is shown) and the user may reject — that is fine. Write nothing that escapes the project root.",
      input: CommitInput,
      output: Output,
      toModelOutput,
      execute: (input, context) =>
        Effect.gen(function* () {
          const now = new Date().toISOString()
          const opsByFolder = new Map<string, Op[]>()
          const pushOp = (folder: string, op: Op) => {
            const bucket = opsByFolder.get(folder) ?? []
            bucket.push(op)
            opsByFolder.set(folder, bucket)
          }

          for (const item of input.folder_summaries ?? []) {
            const folder = normalizeRel(root, item.path)
            if (!folder) continue
            const basedOn = yield* hydrateBasedOn(fs, root, item.based_on ?? [])
            pushOp(folder, { kind: "folder", summary: item.summary, basedOn })
          }

          for (const item of input.entries ?? []) {
            const full = normalizeRel(root, item.path)
            if (!full) continue
            const folder = full.split("/").slice(0, -1).join("/")
            const name = full.split("/").pop()!
            const basedOn = yield* hydrateBasedOn(fs, root, item.based_on ?? [full])
            const confidence: Confidence = item.confidence ?? "observed"
            pushOp(folder, { kind: "entry", name, summary: item.summary, basedOn, confidence })
          }

          for (const item of input.relations ?? []) {
            const from = normalizeRel(root, item.from)
            const to = normalizeRel(root, item.to)
            if (!from || !to) continue
            const folder = relationFolder(from, to)
            const basedOn = yield* hydrateBasedOn(fs, root, item.based_on ?? [])
            const confidence: Confidence = item.confidence ?? "observed"
            pushOp(folder, {
              kind: "relation",
              from: relTo(from, folder),
              to: relTo(to, folder),
              description: item.description,
              basedOn,
              confidence,
            })
          }

          for (const entryPath of input.removed?.entries ?? []) {
            const full = normalizeRel(root, entryPath)
            if (!full) continue
            const folder = full.split("/").slice(0, -1).join("/")
            pushOp(folder, { kind: "removeEntry", name: full.split("/").pop()! })
          }
          for (const rel of input.removed?.relations ?? []) {
            const from = normalizeRel(root, rel.from)
            const to = normalizeRel(root, rel.to)
            if (!from || !to) continue
            const folder = relationFolder(from, to)
            pushOp(folder, { kind: "removeRelation", from: relTo(from, folder), to: relTo(to, folder) })
          }

          if (opsByFolder.size === 0) {
            return { text: "Nothing to write — provide folder_summaries, entries, relations, or removed." } satisfies Output
          }

          const edits: Array<{ abs: string; label: string; notebook: Notebook; changes: string[] }> = []
          for (const [folder, ops] of opsByFolder) {
            const abs = notebookPathFor(root, folder)
            const nb = yield* loadNotebook(fs, abs, folder)
            const result = applyOps(nb, ops)
            if (!result.dirty) continue
            edits.push({ abs, label: `${folder || "."}/${NOTEBOOK_NAME}`, notebook: { ...result.nb, updated: now }, changes: result.changes })
          }

          if (edits.length === 0) {
            return { text: "Nothing changed — summaries already match, and nothing in `removed` was found." } satisfies Output
          }

          const diffs: string[] = []
          for (const edit of edits) {
            const before = yield* fs.readFileStringSafe(edit.abs)
            const after = serializeNotebook(edit.notebook)
            const diff = unifiedDiff(before ?? "", after, edit.label)
            if (diff) diffs.push(diff)
          }

          if (diffs.length > 0) {
            yield* permission.assert({
              action: "edit",
              resources: edits.map((edit) => edit.abs),
              save: ["*"],
              sessionID: context.sessionID,
              agent: context.agent,
              source: {
                type: "tool",
                messageID: context.assistantMessageID,
                callID: context.toolCallID,
              },
            })
          }

          for (const edit of edits) {
            yield* fs.ensureDir(edit.abs.split("/").slice(0, -1).join("/") || ".")
            yield* fs.writeWithDirs(edit.abs, serializeNotebook(edit.notebook))
          }

          const result: string[] = []
          for (const edit of edits) result.push(`- ${edit.label}: ${edit.changes.join("; ")}`)
          return { text: result.join("\n") } satisfies Output
        }).pipe(
          Effect.mapError((error) => new ToolFailure({ message: error instanceof Error ? error.message : String(error) })),
        ),
    })

    yield* tools
      .register({ [nameGet]: notesGet, [nameCommit]: Tool.withPermission(notesCommit, "edit") })
      .pipe(Effect.orDie)
  }),
)

export const node = makeLocationNode({
  name: "tool/notebook",
  layer,
  deps: [ToolRegistry.node, FSUtil.node, PermissionV2.node, Location.node],
})

// ---------- scoring helpers ----------

function scoredEntries(
  notebooks: ReadonlyArray<Notebook>,
  query: string,
  limit: number,
): Array<{ nb: Notebook; name: string; summary: string; basedOn: BasedOn; score: number }> {
  const out: Array<{ nb: Notebook; name: string; summary: string; basedOn: BasedOn; score: number }> = []
  for (const nb of notebooks) {
    for (const entry of Object.values(nb.entries)) {
      const score = scoreEntry(entry, query)
      if (score > 0) out.push({ nb, name: entry.name, summary: entry.summary, basedOn: entry.based_on, score })
    }
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit)
}

function scoredRelations(
  notebooks: ReadonlyArray<Notebook>,
  query: string,
  limit: number,
): Array<{ nb: Notebook; rel: { from: string; to: string; description: string }; basedOn: BasedOn; score: number }> {
  const out: Array<{ nb: Notebook; rel: { from: string; to: string; description: string }; basedOn: BasedOn; score: number }> = []
  for (const nb of notebooks) {
    for (const rel of nb.relations) {
      const score = scoreRelation(rel, query)
      if (score > 0) out.push({ nb, rel, basedOn: rel.based_on, score })
    }
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit)
}
