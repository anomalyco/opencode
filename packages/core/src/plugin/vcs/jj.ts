export * as VcsJjPlugin from "./jj.js"

import { Effect } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { define } from "@opencode-ai/plugin/effect/plugin"
import { FileDiff } from "@opencode-ai/schema/file-diff"
import { BranchList, FileStatus, Info, Mode } from "@opencode-ai/schema/vcs"
import { AppProcess } from "@opencode-ai/util/process"
import { Location } from "../../location.js"
import { ProjectJj } from "../../project/jj.js"
import type { Adapter, BranchOptions, DiffOptions } from "../../vcs.js"
import { countPatch, emptyPatch, MAX_TOTAL_PATCH_BYTES, PATCH_CONTEXT_LINES, splitGitPatch } from "../../vcs/patch.js"

export const Plugin = define({
  id: ProjectJj.id,
  vcs: ProjectJj.vcs,
  effect: Effect.fn("VcsJjPlugin")(function* (ctx) {
    const location = yield* Location.Service
    if (location.vcs?.type !== "jj" && location.vcsBackend !== "jj") return

    const processes = yield* AppProcess.Service
    const adapter = make(processes, location.directory)

    yield* ctx.vcs.transform((draft) => {
      draft.add({
        id: "jj",
        name: "Jujutsu",
        info: () => adapter.info(),
        branches: (input) => adapter.branches({ search: input.search, limit: input.limit }),
        status: () => adapter.status(),
        diff: (input) => adapter.diff(input.mode, { context: input.context }),
      })
    })
  }),
})

function make(proc: AppProcess.Interface, directory: string): Adapter {
  const run = Effect.fnUntraced(
    function* (args: string[], options?: { metadata?: boolean; maxOutputBytes?: number }) {
      const result = yield* proc.run(
        ChildProcess.make(
          "jj",
          ["--color", "never", "--no-pager", ...(options?.metadata ? ["--ignore-working-copy"] : []), ...args],
          { cwd: directory, extendEnv: true, stdin: "ignore" },
        ),
        { maxOutputBytes: options?.maxOutputBytes },
      )
      return {
        exitCode: result.exitCode,
        text: () => result.stdout.toString("utf8"),
        truncated: result.stdoutTruncated || result.stderrTruncated,
      }
    },
    Effect.orElseSucceed(() => ({ exitCode: 1, text: () => "", truncated: false })),
  )

  const bookmarks = Effect.fnUntraced(function* (revision?: string) {
    const result = yield* run(
      ["bookmark", "list", ...(revision ? ["-r", revision] : []), "--sort", "name", "-T", 'name ++ "\\0"'],
      { metadata: true },
    )
    if (result.exitCode !== 0) return []
    return result.text().split("\0").filter(Boolean)
  })

  const base = Effect.fnUntraced(function* () {
    const trunk = (yield* bookmarks("trunk()"))[0]
    if (trunk) return trunk
    const list = yield* bookmarks()
    if (list.includes("main")) return "main"
    if (list.includes("master")) return "master"
    return undefined
  })

  const changes = Effect.fnUntraced(function* (revision: string[], options?: DiffOptions) {
    const listed = yield* run(["diff", ...revision, "-T", 'status ++ "\\t" ++ path ++ "\\0"', "."])
    if (listed.exitCode !== 0) return []
    const items = listed
      .text()
      .split("\0")
      .filter(Boolean)
      .flatMap((entry) => {
        const separator = entry.indexOf("\t")
        if (separator === -1) return []
        const code = entry.slice(0, separator)
        const file = entry.slice(separator + 1)
        if (!file) return []
        const status: FileStatus["status"] =
          code === "added" || code === "copied" ? "added" : code === "removed" ? "deleted" : "modified"
        return [{ file, status }]
      })
    if (items.length === 0) return []

    const result = yield* run(
      ["diff", ...revision, "--git", "--context", String(options?.context ?? PATCH_CONTEXT_LINES), "."],
      { metadata: true, maxOutputBytes: MAX_TOTAL_PATCH_BYTES },
    )
    const patches = splitGitPatch({
      text: result.exitCode === 0 ? result.text() : "",
      truncated: result.truncated,
    })
    return items
      .map((item, index) => {
        const patch = patches[index] ?? emptyPatch(item.file)
        return { ...item, patch, ...countPatch(patch) } satisfies FileDiff.Info
      })
      .toSorted((a, b) => a.file.localeCompare(b.file))
  })

  return {
    info: Effect.fn("VcsJj.info")(function* () {
      const [current, root] = yield* Effect.all([bookmarks("@"), base()], { concurrency: 2 })
      return { branch: { current: current[0], default: root } } satisfies Info
    }),
    branches: Effect.fn("VcsJj.branches")(function* (options?: BranchOptions) {
      const search = options?.search?.trim().toLowerCase()
      return (yield* bookmarks())
        .filter((bookmark) => !search || bookmark.toLowerCase().includes(search))
        .slice(0, options?.limit) satisfies BranchList
    }),
    status: Effect.fn("VcsJj.status")(function* () {
      return (yield* changes(["-r", "@"], { context: 0 })).map((item) => ({
        file: item.file,
        additions: item.additions,
        deletions: item.deletions,
        status: item.status,
      }))
    }),
    diff: Effect.fn("VcsJj.diff")(function* (mode: Mode, options?: DiffOptions) {
      if (mode === "working") return yield* changes(["-r", "@"], options)
      const root = yield* base()
      if (!root) return []
      return yield* changes(["--from", `fork_point(${root} | @)`], options)
    }),
  }
}
