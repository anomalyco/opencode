export * as ProjectContext from "./project-context"

import { ChildProcess } from "effect/unstable/process"
import { Effect, Layer, Schema } from "effect"
import { Location } from "../location"
import { AppProcess } from "../process"
import { makeLocationNode } from "../effect/app-node"
import { SystemContext } from "./index"
import { SystemContextRegistry } from "./registry"

const key = SystemContext.Key.make("project/git/history")

const MAX_COMMITS = 20

/**
 * Project context source — Slice 1 / FASE 14.
 *
 * Admits the recent commit subjects for the working repository as a system
 * context source (`project/git/history`). Git is a best-effort observation:
 * when the directory is not a git repository, git is unavailable, or the log
 * is empty, nothing is admitted (`SystemContext.empty`) — it never returns
 * `unavailable`, so it cannot block `SessionContextEpoch.initialize` outside a
 * git tree.
 *
 * The retrieval logic is exported as a pure, dependency-injected seam so it can
 * be unit-tested without the layer harness.
 */

export interface GitDeps {
  readonly proc: AppProcess.Interface
  readonly directory: Location.Interface["directory"]
}

/** Parses raw `git log --format=%s` output into trimmed, non-empty subjects. */
export const parseCommits = (output: string): string[] =>
  output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

/** Best-effort recent commit subjects for `cwd`; empty when git is unavailable. */
export const loadHistory = (deps: GitDeps): Effect.Effect<string[]> =>
  Effect.gen(function* () {
    const result = yield* deps.proc
      .run(
        ChildProcess.make("git", ["log", `--max-count=${MAX_COMMITS}`, "--format=%s"], {
          cwd: deps.directory,
        }),
      )
      .pipe(Effect.catch(() => Effect.succeed(undefined)))

    if (result === undefined || result.exitCode !== 0) return []
    return parseCommits(result.stdout.toString())
  })

/** Renders an admitted history slice for the model-visible baseline. */
export const render = (history: ReadonlyArray<string>): string =>
  history.length === 0
    ? ""
    : ["Recent project history:", ...history.map((subject, index) => `${index + 1}. ${subject}`)].join("\n")

const source = (history: ReadonlyArray<string>) =>
  SystemContext.make({
    key,
    codec: Schema.toCodecJson(Schema.Array(Schema.String)),
    load: Effect.succeed(history),
    baseline: render,
    update: (_previous, current) =>
      `Recent project history has changed. This list supersedes the previous history.\n\n${render(current)}`,
    removed: () => "Recent project history is no longer available.",
  })

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const proc = yield* AppProcess.Service
    const location = yield* Location.Service
    const registry = yield* SystemContextRegistry.Service

    yield* registry.register({
      key,
      load: loadHistory({ proc, directory: location.directory }).pipe(
        Effect.map((history) => (history.length === 0 ? SystemContext.empty : source(history))),
        Effect.catch(() => Effect.succeed(SystemContext.empty)),
      ),
    })
  }),
)

export const node = makeLocationNode({
  name: "project-context",
  layer,
  deps: [Location.node, AppProcess.node, SystemContextRegistry.node],
})
