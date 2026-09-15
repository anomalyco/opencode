export * as NotebookMemory from "./memory"

import { Effect, Layer, Schema } from "effect"
import { makeLocationNode } from "../effect/app-node"
import { FSUtil } from "../fs-util"
import { Location } from "../location"
import { SystemContext } from "../system-context/index"
import { SystemContextRegistry } from "../system-context/registry"
import { itemFreshness, allNotebooks } from "./store"
import type { Freshness } from "./notebook"

const LIMIT = 2_500

const FreshnessCodec = Schema.Union([
  Schema.Literal("fresh"),
  Schema.Literal("suspect"),
  Schema.Literal("stale"),
])

const MemoryEntryChildren = Schema.Struct({
  name: Schema.String,
  summary: Schema.String,
  freshness: FreshnessCodec,
})

const MemoryEntry = Schema.Struct({
  rel: Schema.String,
  summary: Schema.String,
  freshness: FreshnessCodec,
  entries: Schema.Array(MemoryEntryChildren),
})
type MemoryEntry = typeof MemoryEntry.Type

const key = SystemContext.Key.make("core/notebook")

const badge = (freshness: Freshness): string =>
  freshness === "fresh" ? "✓" : freshness === "suspect" ? "⚠ suspect" : "✗ stale"

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const location = yield* Location.Service
    const registry = yield* SystemContextRegistry.Service

    const observe = Effect.fn("NotebookMemory.observe")(function* () {
      const root = location.project.directory
      const notebooks = yield* allNotebooks(fs, root)
      const entries: Array<{
        rel: string
        summary: string
        freshness: Freshness
        entries: ReadonlyArray<{ name: string; summary: string; freshness: Freshness }>
      }> = []
      for (const nb of notebooks) {
        const summaryFreshness = yield* itemFreshness(fs, root, nb.based_on)
        const children: Array<{ name: string; summary: string; freshness: Freshness }> = []
        for (const entry of Object.values(nb.entries)) {
          const freshness = yield* itemFreshness(fs, root, entry.based_on)
          children.push({ name: entry.name, summary: entry.summary, freshness })
        }
        entries.push({ rel: nb.rel, summary: nb.summary, freshness: summaryFreshness, entries: children })
      }
      return entries
    })

    const source = (value: ReadonlyArray<MemoryEntry> | SystemContext.Unavailable) =>
      SystemContext.make({
        key,
        codec: Schema.toCodecJson(Schema.Array(MemoryEntry)),
        load: Effect.succeed(value),
        baseline: renderMemory,
        update: (_previous, current) => `Notebook memory updated:\n\n${renderMemory(current)}`,
        removed: () => "Previously recorded notebook memory no longer applies.",
      })

    yield* registry.register({
      key,
      load: observe().pipe(
        Effect.map((entries) => (entries.length === 0 ? SystemContext.empty : source(entries))),
        Effect.catch(() => Effect.succeed(source(SystemContext.unavailable))),
        Effect.catchDefect(() => Effect.succeed(source(SystemContext.unavailable))),
      ),
    })
  }),
)

export const node = makeLocationNode({
  name: "system-context-notebook",
  layer,
  deps: [FSUtil.node, Location.node, SystemContextRegistry.node],
})

function renderMemory(entries: ReadonlyArray<MemoryEntry>): string {
  const lines: string[] = ["## Notebook memory", ""]
  for (const nb of entries) {
    const head = nb.rel === "" ? "- `.` (project root)" : `- \`${nb.rel}\``
    const body: string[] = [head]
    if (nb.summary) body.push(`  [${badge(nb.freshness)}] **folder** — ${nb.summary}`)
    for (const entry of nb.entries.slice(0, 2)) body.push(`  [${badge(entry.freshness)}] **${entry.name}** — ${entry.summary}`)
    const block = body.join("\n")
    if (lines.join("\n").length + block.length > LIMIT) break
    lines.push(block)
  }
  lines.push(
    "",
    "This digest only SAMPLES memory (up to 2 entries per folder) — it is a pointer and an index, not the full map.",
    "At the START of a task — and before answering any general question about this project (what it is, how to run it, its progress, what is left) — call `notes_get` (pass a task or the target path) to load the full per-file memory already summarized here. It is cheap and local, so prefer it to re-reading code you have already mapped.",
    "Trust the structure and summaries so you don't re-explore.",
    "Write every notebook summary (folder, entry, relation) in English, even when the conversation is in another language — keep the map language-stable.",
    "Entries: ✓ safe to rely on · ⚠ suspect — its source changed, skim that one file to confirm · ✗ stale — its source is gone, treat as unverified.",
    "Re-read a file only to resolve a ⚠/✗ entry or when a note contradicts what you directly observe; then the code wins, point-wise.",
  )
  return lines.join("\n")
}
