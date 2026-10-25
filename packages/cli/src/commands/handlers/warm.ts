import path from "node:path"
import { Effect } from "effect"
import { effectCmd, fail } from "../effect-cmd"
import { UI } from "../ui"
import type { Index } from "./indexer"

/** Renders a millisecond duration for the step report. */
export function elapsed(start: number, end: number) {
  return `${Math.max(0, Math.round(end - start))}ms`
}

export const WarmCommand = effectCmd({
  command: "warm",
  describe: "pre-load project context and prompt cache before you start typing",
  builder: (yargs) =>
    yargs.option("index", {
      type: "boolean",
      default: true,
      describe: "refresh the vector index (disable with --no-index)",
    }),
  handler: Effect.fn("Cli.warm")(function* (args) {
    const begin = performance.now()
    const { InstanceRef } = yield* Effect.promise(() => import("@/effect/instance-ref"))
    const ctx = yield* InstanceRef
    if (!ctx) return yield* fail("Could not load instance context")
    UI.println(`✓ project instance ${UI.Style.TEXT_DIM}${elapsed(begin, performance.now())}${UI.Style.TEXT_NORMAL}`)

    // Resolving merged project config touches every config file the first
    // prompt would otherwise load lazily.
    const configStart = performance.now()
    const { Config } = yield* Effect.promise(() => import("@/config/config"))
    const config = yield* Config.Service
    yield* config.get()
    yield* config.getGlobal()
    UI.println(`✓ config ${UI.Style.TEXT_DIM}${elapsed(configStart, performance.now())}${UI.Style.TEXT_NORMAL}`)

    // Refreshing the models catalog populates the on-disk cache that prompt
    // assembly reads for model metadata; the TTL keeps repeat warms cheap.
    const modelsStart = performance.now()
    const { ModelsDev } = yield* Effect.promise(() => import("@bolt-ai/core/models-dev"))
    const models = yield* ModelsDev.Service
    yield* models.refresh()
    yield* models.get()
    UI.println(`✓ models catalog ${UI.Style.TEXT_DIM}${elapsed(modelsStart, performance.now())}${UI.Style.TEXT_NORMAL}`)

    if (args.index) {
      // Reuses the incremental vector index from `bolt index` so semantic
      // search hits a fresh index on the first prompt.
      const indexStart = performance.now()
      const indexer = yield* Effect.promise(() => import("./indexer"))
      const cwd = process.cwd()
      const out = path.join(cwd, "codebase-index.json")
      const stored = yield* Effect.promise(async (): Promise<Index> => {
        const handle = Bun.file(out)
        if (!(await handle.exists())) return { version: 1, files: {} }
        return (await handle.json()) as Index
      })
      const scanned = yield* Effect.promise(() => Array.fromAsync(new Bun.Glob("**/*").scan({ cwd })))
      const names = scanned
        .map((name) => name.replaceAll("\\", "/"))
        .filter(indexer.indexable)
        .sort()
      const files: Record<string, string> = {}
      for (const name of names) {
        const handle = Bun.file(path.join(cwd, name))
        if (handle.size > 200_000) continue
        files[name] = yield* Effect.promise(() => handle.text())
      }
      const result = indexer.refresh(stored, files)
      yield* Effect.promise(() => Bun.write(out, JSON.stringify(result.index)))
      UI.println(
        `✓ vector index: ${Object.keys(result.index.files).length} files (+${result.stats.added} ~${result.stats.updated} -${result.stats.removed}) ${UI.Style.TEXT_DIM}${elapsed(indexStart, performance.now())}${UI.Style.TEXT_NORMAL}`,
      )
    }

    UI.println(
      UI.Style.TEXT_SUCCESS_BOLD +
        "warm complete" +
        UI.Style.TEXT_NORMAL +
        ` ${UI.Style.TEXT_DIM}${elapsed(begin, performance.now())}${UI.Style.TEXT_NORMAL}`,
    )
  }),
})
