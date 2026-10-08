export * as ProjectStructure from "./structure-context"

import { ChildProcess } from "effect/unstable/process"
import { Effect, Layer, Schema } from "effect"
import { Location } from "../location"
import { AppProcess } from "../process"
import { makeLocationNode } from "../effect/app-node"
import { SystemContext } from "./index"
import { SystemContextRegistry } from "./registry"
import { compressToBudget, estimateTokens } from "./relevance"

const key = SystemContext.Key.make("project/structure")

const MAX_FILES = 40
const TOKEN_BUDGET = 400

/** File extensions that carry structural signal; everything else is ignored. */
const RELEVANT = /\.(ts|tsx|js|jsx|mjs|cjs|json|md|markdown|yaml|yml|toml|env|cfg)$/

export interface StructureDeps {
  readonly proc: AppProcess.Interface
  readonly directory: Location.Interface["directory"]
}

/** Parse `git ls-files` output into trimmed, non-empty paths. */
export const parseFiles = (output: string): string[] =>
  output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

/**
 * Structural salience for path ranking. Baseline admission has no per-call
 * query, so we order by depth (shallow first), directory-before-file, and
 * important entry names. Per-turn *query* ranking stays in
 * `relevance.rankByRelevance`; this keeps the structure summary predictable.
 */
const salience = (path: string): number => {
  const parts = path.split("/")
  const depth = parts.length
  const base = parts[parts.length - 1] ?? ""
  const important =
    base === "package.json" ||
    base === "tsconfig.json" ||
    base === "index.ts" ||
    base === "index.tsx" ||
    base === "index.js" ||
    base === "README.md" ||
    base === "README.markdown"
      ? 2
      : 0
  const directory = base.includes(".") ? 0 : 1
  return -depth * 10 + important + directory
}

/** Orders files by structural salience (stable on ties via path). */
export const orderFiles = (files: ReadonlyArray<string>): string[] =>
  Array.from(files).sort((a, b) => salience(b) - salience(a) || a.localeCompare(b))

/** Keeps only structurally-relevant, non-metadata files. */
export const filterFiles = (files: ReadonlyArray<string>): string[] =>
  files.filter((file) => file.startsWith(".git/") === false && RELEVANT.test(file))

/**
 * Best-effort project file structure for `cwd`.
 *
 * Git is a best-effort observation: when the directory is not a git repo, git is
 * unavailable, or ls-files exits non-zero, nothing is admitted (`[]`) — never
 * `unavailable`, so it cannot block `SessionContextEpoch.initialize` outside a
 * git tree.
 */
export const loadFiles = (deps: StructureDeps): Effect.Effect<string[]> =>
  Effect.gen(function* () {
    const result = yield* deps.proc
      .run(ChildProcess.make("git", ["ls-files"], { cwd: deps.directory }))
      .pipe(Effect.catch(() => Effect.succeed(undefined)))

    if (result === undefined || result.exitCode !== 0) return []
    return filterFiles(parseFiles(result.stdout.toString())).slice(0, MAX_FILES)
  })

/**
 * Renders a relevance-trimmed, budget-capped structure summary for the model.
 * Emits "" when there is nothing to admit so callers can fall back to
 * `SystemContext.empty` (admitting a non-empty baseline is required by `make`).
 */
export const render = (files: ReadonlyArray<string>): string => {
  if (files.length === 0) return ""
  const lines = orderFiles(files)
  const budgeted = compressToBudget(
    lines.map((text) => ({ text })),
    TOKEN_BUDGET,
    (text) => estimateTokens(text),
  )
  const head = "Project structure (filtered, budget-capped):"
  const body = budgeted.map((line) => `  ${line.text}`).join("\n")
  const truncated =
    budgeted.length < lines.length
      ? `\n(${budgeted.length}/${lines.length} files shown; remaining structure trimmed to stay within the token budget)`
      : ""
  return `${head}\n${body}${truncated}`
}

const source = (files: ReadonlyArray<string>) =>
  SystemContext.make({
    key,
    codec: Schema.toCodecJson(Schema.Array(Schema.String)),
    load: Effect.succeed(files),
    baseline: render,
    update: (_previous, current) =>
      `Project file structure has changed. This list supersedes the previous structure.\n\n${render(current)}`,
    removed: () => "Project file structure is no longer available.",
  })

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const proc = yield* AppProcess.Service
    const location = yield* Location.Service
    const registry = yield* SystemContextRegistry.Service

    yield* registry.register({
      key,
      load: loadFiles({ proc, directory: location.directory }).pipe(
        Effect.map((files) => (files.length === 0 ? SystemContext.empty : source(files))),
        Effect.catch(() => Effect.succeed(SystemContext.empty)),
      ),
    })
  }),
)

export const node = makeLocationNode({
  name: "project-structure",
  layer,
  deps: [Location.node, AppProcess.node, SystemContextRegistry.node],
})
