export * as ProjectImports from "./import-context"

import { ChildProcess } from "effect/unstable/process"
import { Effect, Layer, Schema } from "effect"
import { Location } from "../location"
import { AppProcess } from "../process"
import { makeLocationNode } from "../effect/app-node"
import { SystemContext } from "./index"
import { SystemContextRegistry } from "./registry"
import { compressToBudget, estimateTokens } from "./relevance"

const key = SystemContext.Key.make("project/imports")

const MAX_IMPORTS = 40
const TOKEN_BUDGET = 400

/** Matches `... from "mod"` / `... from 'mod'` (with the `from` keyword). */
const FROM = /from\s*["']([^"']+)["']/g
/** Matches side-effect `import "mod"` / `import 'mod'` (no `from`). */
const SIDE = /import\s*["']([^"']+)["']/g

export interface ImportDeps {
  readonly proc: AppProcess.Interface
  readonly directory: Location.Interface["directory"]
}

/**
 * Extracts module specifiers from `import ... from` / side-effect `import` lines.
 * Pure & deterministic — no git process required in tests.
 */
export const extractSpecifiers = (lines: ReadonlyArray<string>): string[] => {
  const out: string[] = []
  for (const line of lines) {
    let match: RegExpExecArray | null
    FROM.lastIndex = 0
    while ((match = FROM.exec(line)) !== null) out.push(match[1])
    SIDE.lastIndex = 0
    while ((match = SIDE.exec(line)) !== null) out.push(match[1])
  }
  return out
}

/** Unique specifiers ordered by descending reference frequency (stable on ties). */
export const rankByFrequency = (specifiers: ReadonlyArray<string>): string[] => {
  const counts = new Map<string, number>()
  const order: string[] = []
  for (const specifier of specifiers) {
    if (!counts.has(specifier)) order.push(specifier)
    counts.set(specifier, (counts.get(specifier) ?? 0) + 1)
  }
  return order.sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || a.localeCompare(b))
}

/**
 * Best-effort project imports graph for `cwd`, via `git grep`.
 *
 * Git is a best-effort observation: when the directory is not a git repo, git is
 * unavailable, or grep exits non-zero, nothing is admitted (`[]`) — never
 * `unavailable`, so it cannot block `SessionContextEpoch.initialize` outside a
 * git tree.
 */
export const loadImports = (deps: ImportDeps): Effect.Effect<string[]> =>
  Effect.gen(function* () {
    const result = yield* deps.proc
      .run(
        ChildProcess.make(
          "git",
          ["grep", "-h", "-E", "^(import|export) "],
          { cwd: deps.directory },
        ),
      )
      .pipe(Effect.catch(() => Effect.succeed(undefined)))

    if (result === undefined || result.exitCode !== 0) return []
    return rankByFrequency(extractSpecifiers(result.stdout.toString().split("\n"))).slice(0, MAX_IMPORTS)
  })

/**
 * Renders a relevance-trimmed, budget-capped imports summary for the model.
 * Emits "" when empty so callers can fall back to `SystemContext.empty`.
 */
export const render = (specifiers: ReadonlyArray<string>): string => {
  if (specifiers.length === 0) return ""
  const budgeted = compressToBudget(
    specifiers.map((specifier) => ({ text: specifier })),
    TOKEN_BUDGET,
    (text) => estimateTokens(text),
  )
  const head = "Project imports (top referenced modules):"
  const body = budgeted.map((line) => `  ${line.text}`).join("\n")
  const truncated =
    budgeted.length < specifiers.length
      ? `\n(${budgeted.length}/${specifiers.length} shown; remaining imports trimmed to stay within the token budget)`
      : ""
  return `${head}\n${body}${truncated}`
}

const source = (specifiers: ReadonlyArray<string>) =>
  SystemContext.make({
    key,
    codec: Schema.toCodecJson(Schema.Array(Schema.String)),
    load: Effect.succeed(specifiers),
    baseline: render,
    update: (_previous, current) =>
      `Project imports have changed. This list supersedes the previous imports.\n\n${render(current)}`,
    removed: () => "Project imports are no longer available.",
  })

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const proc = yield* AppProcess.Service
    const location = yield* Location.Service
    const registry = yield* SystemContextRegistry.Service

    yield* registry.register({
      key,
      load: loadImports({ proc, directory: location.directory }).pipe(
        Effect.map((specifiers) => (specifiers.length === 0 ? SystemContext.empty : source(specifiers))),
        Effect.catch(() => Effect.succeed(SystemContext.empty)),
      ),
    })
  }),
)

export const node = makeLocationNode({
  name: "project-imports",
  layer,
  deps: [Location.node, AppProcess.node, SystemContextRegistry.node],
})
