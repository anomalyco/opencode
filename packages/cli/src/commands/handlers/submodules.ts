import { Effect } from "effect"
import { UI } from "../ui"
import { effectCmd, fail } from "../effect-cmd"

export type Module = {
  readonly name: string
  readonly path: string
  readonly url: string
  readonly branch?: string
}

export type State = {
  readonly path: string
  readonly sha: string
  readonly status: "ok" | "uninitialized" | "drifted" | "conflicted"
}

/** Parse .gitmodules content into declared submodules. */
export function modules(text: string) {
  const found: { name: string; path?: string; url?: string; branch?: string }[] = []
  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith(";")) continue
    const header = trimmed.match(/^\[submodule\s+"(.+)"\]$/)
    if (header) {
      found.push({ name: header[1] })
      continue
    }
    const entry = trimmed.match(/^(path|url|branch)\s*=\s*(.+)$/)
    if (!entry) continue
    const current = found.at(-1)
    if (!current) continue
    if (entry[1] === "path") current.path = entry[2].trim()
    if (entry[1] === "url") current.url = entry[2].trim()
    if (entry[1] === "branch") current.branch = entry[2].trim()
  }
  return found
    .filter((item): item is { name: string; path: string; url: string; branch?: string } =>
      Boolean(item.path && item.url),
    )
    .map(
      (item) =>
        ({
          name: item.name,
          path: item.path,
          url: item.url,
          ...(item.branch ? { branch: item.branch } : {}),
        }) satisfies Module,
    )
}

/** Parse `git submodule status --recursive` output into per-path states. */
export function states(text: string) {
  return text
    .split("\n")
    .map((line) => line.match(/^([ \-+U])([0-9a-f]{40})\s+(\S+)/))
    .filter((match): match is RegExpMatchArray => match !== null)
    .map((match) => {
      const flag = match[1]
      const status =
        flag === "-" ? "uninitialized" : flag === "+" ? "drifted" : flag === "U" ? "conflicted" : ("ok" as const)
      return { path: match[3], sha: match[2], status } satisfies State
    })
}

/** Join declared submodules with observed states into report rows. */
export function report(declared: Module[], observed: State[]) {
  const known = observed.map((state) => state.path)
  const missing = declared
    .filter((module) => !known.includes(module.path))
    .map((module) => ({ path: module.path, sha: "", status: "uninitialized" as const }))
  return [...observed, ...missing]
}

export const SubmodulesCommand = effectCmd({
  command: "submodules",
  describe: "report submodule drift and bring submodules in sync",
  builder: (yargs) =>
    yargs.option("sync", {
      type: "boolean",
      default: false,
      describe: "run git submodule sync and update --init --recursive",
    }),
  handler: Effect.fn("Cli.submodules")(function* (args) {
    const { InstanceRef } = yield* Effect.promise(() => import("@/effect/instance-ref"))
    const { Git } = yield* Effect.promise(() => import("@/git"))
    const ctx = yield* InstanceRef
    if (!ctx) return yield* fail("Could not load instance context")
    if (ctx.project.vcs !== "git") {
      return yield* fail("Could not find git repository. Please run this command from a git repository.")
    }
    const git = yield* Git.Service
    const cwd = ctx.worktree

    const config = yield* Effect.promise(() =>
      Bun.file(`${cwd}/.gitmodules`)
        .text()
        .catch(() => ""),
    )
    const declared = modules(config)
    if (!declared.length) {
      UI.println("This repository declares no submodules.")
      return
    }

    const status = yield* git.run(["submodule", "status", "--recursive"], { cwd })
    if (status.exitCode !== 0) return yield* fail(status.stderr.toString().trim() || "git submodule status failed")
    const rows = report(declared, states(status.text()))

    UI.println(`${declared.length} declared submodule${declared.length === 1 ? "" : "s"}:`)
    for (const row of rows) {
      const label =
        row.status === "ok"
          ? "in sync"
          : row.status === "uninitialized"
            ? "not initialized"
            : row.status === "drifted"
              ? "checkout differs from the recorded commit"
              : "has merge conflicts"
      UI.println(`  ${row.path}: ${label}${row.sha ? ` (${row.sha.slice(0, 7)})` : ""}`)
    }

    const broken = rows.filter((row) => row.status !== "ok")
    if (!broken.length) {
      UI.println("All submodules are in sync.")
      return
    }
    if (!args.sync) {
      UI.empty()
      UI.println(
        `${broken.length} submodule${broken.length === 1 ? " is" : "s are"} out of sync. Rerun with --sync to fix.`,
      )
      process.exitCode = 1
      return
    }

    const conflicted = rows.filter((row) => row.status === "conflicted")
    if (conflicted.length) {
      return yield* fail(
        `Refusing to sync while submodules have merge conflicts: ${conflicted.map((row) => row.path).join(", ")}. Resolve the conflicts first.`,
      )
    }

    UI.empty()
    UI.println("Syncing submodule urls...")
    const synced = yield* git.run(["submodule", "sync", "--recursive"], { cwd })
    if (synced.exitCode !== 0) return yield* fail(synced.stderr.toString().trim() || "git submodule sync failed")

    UI.println("Updating submodules to their recorded commits...")
    const updated = yield* git.run(["submodule", "update", "--init", "--recursive"], { cwd })
    if (updated.exitCode !== 0) return yield* fail(updated.stderr.toString().trim() || "git submodule update failed")

    const after = yield* git.run(["submodule", "status", "--recursive"], { cwd })
    const left = report(declared, states(after.text())).filter((row) => row.status !== "ok")
    if (left.length) {
      return yield* fail(`Still out of sync after update: ${left.map((row) => row.path).join(", ")}`)
    }
    UI.println("All submodules are now in sync.")
  }),
})
