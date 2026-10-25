import path from "path"
import { existsSync } from "fs"
import { Effect } from "effect"
import { isRecord } from "@/util/record"
import { UI } from "../../ui"
import { effectCmd, fail } from "../../effect-cmd"

export type Change = { path: string; kind: "added" | "removed" | "changed"; before?: unknown; after?: unknown }

// Flatten a parsed config into leaf paths; arrays and empty objects count as leaf values.
function flatten(value: unknown, prefix: string[] = []): Map<string, unknown> {
  if (!isRecord(value) || !Object.keys(value).length) {
    return new Map(prefix.length ? [[prefix.join("."), value]] : [])
  }
  return new Map(Object.entries(value).flatMap(([key, child]) => [...flatten(child, [...prefix, key])]))
}

/** Per-key differences between a committed config object and the local one. */
export function changes(base: unknown, next: unknown): Change[] {
  const left = flatten(base)
  const right = flatten(next)
  const paths = Array.from(new Set([...left.keys(), ...right.keys()])).sort()
  return paths.flatMap((item): Change[] => {
    const has = { left: left.has(item), right: right.has(item) }
    if (!has.left) return [{ path: item, kind: "added", after: right.get(item) }]
    if (!has.right) return [{ path: item, kind: "removed", before: left.get(item) }]
    if (JSON.stringify(left.get(item)) === JSON.stringify(right.get(item))) return []
    return [{ path: item, kind: "changed", before: left.get(item), after: right.get(item) }]
  })
}

/** Render one change as a diff-style line. */
export function line(change: Change) {
  if (change.kind === "added") return `  + ${change.path} = ${JSON.stringify(change.after)}`
  if (change.kind === "removed") return `  - ${change.path} (was ${JSON.stringify(change.before)})`
  return `  ~ ${change.path}: ${JSON.stringify(change.before)} -> ${JSON.stringify(change.after)}`
}

export const DiffCommand = effectCmd({
  command: "diff",
  describe: "show what differs between local config files and the committed project config",
  builder: (yargs) =>
    yargs.option("patch", {
      type: "boolean",
      default: false,
      describe: "print a unified diff instead of per-key changes",
    }),
  handler: Effect.fn("Cli.config.diff")(function* (args) {
    const { InstanceRef } = yield* Effect.promise(() => import("@/effect/instance-ref"))
    const { Git } = yield* Effect.promise(() => import("@/git"))
    const { ConfigParse } = yield* Effect.promise(() => import("@/config/parse"))
    const { ConfigPaths } = yield* Effect.promise(() => import("@/config/paths"))
    const ctx = yield* InstanceRef
    if (!ctx) return yield* fail("Could not load instance context")
    if (ctx.project.vcs !== "git") {
      return yield* fail("Could not find git repository. Please run this command from a git repository.")
    }

    const git = yield* Git.Service
    const cwd = ctx.worktree

    const files = yield* Effect.gen(function* () {
      const project = yield* Effect.all(
        [
          ConfigPaths.files("bolt", ctx.directory, ctx.worktree),
          ConfigPaths.files("bolt", ctx.directory, ctx.worktree),
        ],
        { concurrency: 2 },
      ).pipe(Effect.orDie)
      const directories = yield* ConfigPaths.directories(ctx.directory, ctx.worktree).pipe(Effect.orDie)
      const nested = directories
        .filter((dir) => dir.endsWith(".bolt") || dir.endsWith(".bolt"))
        .flatMap((dir) => ["bolt.jsonc", "bolt.json", "bolt.jsonc", "bolt.json"].map((name) => path.join(dir, name)))
      return Array.from(new Set([...project.flat(), ...nested]))
        .filter((file) => !path.relative(cwd, file).startsWith(".."))
        .sort()
    })

    const findings = yield* Effect.forEach(
      files,
      Effect.fnUntraced(function* (file) {
        const relative = path.relative(cwd, file).split(path.sep).join("/")
        const committed = yield* git.show(cwd, "HEAD", relative)
        const local = existsSync(file) ? yield* Effect.promise(() => Bun.file(file).text()) : ""
        if (!committed && !local) return []
        if (committed === local) return []
        return [{ file, relative, committed, local }]
      }),
    ).pipe(Effect.map((list) => list.flat()))

    if (!findings.length) {
      UI.println("No differences between local config and the committed project config.")
      return
    }

    for (const finding of findings) {
      if (args.patch) {
        const { createTwoFilesPatch } = yield* Effect.promise(() => import("diff"))
        UI.println(
          createTwoFilesPatch(
            `${finding.relative} (HEAD)`,
            finding.relative,
            finding.committed,
            finding.local,
          ).trimEnd(),
        )
        continue
      }
      const status = !finding.committed ? " (not committed)" : !finding.local ? " (deleted locally)" : ""
      UI.println(`${finding.relative}${status}`)
      const base = finding.committed ? ConfigParse.jsonc(finding.committed, `${finding.relative}@HEAD`) : {}
      const next = finding.local ? ConfigParse.jsonc(finding.local, finding.relative) : {}
      const list = changes(base, next)
      if (!list.length) UI.println("  (only comments or formatting changed)")
      for (const change of list) UI.println(line(change))
      UI.empty()
    }
  }),
})
