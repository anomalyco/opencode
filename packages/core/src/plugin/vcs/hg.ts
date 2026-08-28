export * as VcsHgPlugin from "./hg.js"

import path from "path"
import { Effect } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { define } from "@opencode-ai/plugin/effect/plugin"
import { FileDiff } from "@opencode-ai/schema/file-diff"
import { FileStatus, Info, Mode } from "@opencode-ai/schema/vcs"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { AppProcess } from "@opencode-ai/util/process"
import { Location } from "../../location.js"
import type { Adapter, DiffOptions } from "../../vcs.js"
import {
  addPatch,
  chunksByFile,
  countPatch,
  deletePatch,
  emptyPatch,
  MAX_PATCH_BYTES,
  MAX_TOTAL_PATCH_BYTES,
  PATCH_CONTEXT_LINES,
} from "../../vcs/patch.js"

export const Plugin = define({
  id: "opencode.vcs.hg",
  vcs: { id: "hg", markers: [".hg"] },
  effect: Effect.fn("VcsHgPlugin")(function* (ctx) {
    const location = yield* Location.Service
    if (location.vcs?.type !== "hg") return

    const processes = yield* AppProcess.Service
    const fs = yield* FSUtil.Service
    const adapter = make(processes, fs, {
      directory: location.directory,
      worktree: location.project.directory,
    })

    yield* ctx.vcs.transform((draft) => {
      draft.add({
        id: "hg",
        name: "Mercurial",
        info: () => adapter.info(),
        branches: (input) => adapter.branches({ search: input.search, limit: input.limit }),
        status: () => adapter.status(),
        diff: (input) => adapter.diff(input.mode, { context: input.context }),
      })
    })
  }),
})

/**
 * Mercurial adapter for the Vcs service. `hg diff --git` emits git-format
 * patches for tracked changes; untracked (`?`) and missing (`!`) files never
 * appear in `hg diff`, so their patches are synthesized from file contents.
 */
function make(
  proc: AppProcess.Interface,
  fs: FSUtil.Interface,
  input: { directory: string; worktree: string },
): Adapter {
  const hg = makeHg(proc, input.worktree)
  // All commands run from the worktree root (hg prints root-relative paths);
  // this pathspec scopes them to the requested directory.
  const scope = path.relative(input.worktree, input.directory) || "."

  const patchFor = Effect.fnUntraced(function* (item: Item, rev: string | undefined, chunk: string | undefined) {
    if (chunk !== undefined) return chunk
    if (item.code === "?") {
      const content = yield* fs
        .readFileString(path.join(input.worktree, item.file))
        .pipe(Effect.orElseSucceed(() => undefined))
      if (content === undefined || Buffer.byteLength(content) > MAX_PATCH_BYTES) return emptyPatch(item.file)
      return addPatch(item.file, content)
    }
    if (item.code === "!") {
      const content = yield* hg.cat(rev ?? ".", item.file)
      if (content === undefined || Buffer.byteLength(content) > MAX_PATCH_BYTES) return emptyPatch(item.file)
      return deletePatch(item.file, content)
    }
    return emptyPatch(item.file)
  })

  const diffAgainst = Effect.fnUntraced(function* (rev: string | undefined, options?: DiffOptions) {
    const [items, batch] = yield* Effect.all(
      [hg.status(rev, scope), hg.diff(rev, scope, { context: options?.context ?? PATCH_CONTEXT_LINES })],
      { concurrency: 2 },
    )
    const chunks = chunksByFile(batch, () => undefined)
    const list: FileDiff.Info[] = []
    for (const item of items.toSorted((a, b) => a.file.localeCompare(b.file))) {
      const patch = yield* patchFor(item, rev, chunks.get(item.file))
      const counts = countPatch(patch)
      list.push({
        file: item.file,
        patch,
        additions: counts.additions,
        deletions: counts.deletions,
        status: item.status,
      })
    }
    return list
  })

  return {
    info: Effect.fn("VcsHg.info")(function* () {
      return { branch: { current: yield* hg.branch(), default: "default" } } satisfies Info
    }),
    branches: Effect.fn("VcsHg.branches")(function* () {
      return []
    }),
    status: Effect.fn("VcsHg.status")(function* () {
      return (yield* diffAgainst(undefined, { context: 0 })).map(
        (item) =>
          ({
            file: item.file,
            additions: item.additions,
            deletions: item.deletions,
            status: item.status,
          }) satisfies FileStatus,
      )
    }),
    diff: Effect.fn("VcsHg.diff")(function* (mode: Mode, options?: DiffOptions) {
      if (mode === "working") return yield* diffAgainst(undefined, options)

      const branch = yield* hg.branch()
      if (!branch || branch === "default") return []
      const ancestor = yield* hg.ancestor()
      if (!ancestor) return []
      return yield* diffAgainst(ancestor, options)
    }),
  }
}

type Kind = FileStatus["status"]

interface Item {
  readonly file: string
  readonly code: string
  readonly status: Kind
}

const kind = (code: string): Kind => {
  if (code === "A" || code === "?") return "added"
  if (code === "R" || code === "!") return "deleted"
  return "modified"
}

function makeHg(proc: AppProcess.Interface, worktree: string) {
  const run = Effect.fnUntraced(
    function* (args: string[], opts?: { maxOutputBytes?: number }) {
      const result = yield* proc.run(
        ChildProcess.make("hg", args, {
          cwd: worktree,
          env: { HGPLAIN: "1" },
          extendEnv: true,
          stdin: "ignore",
        }),
        { maxOutputBytes: opts?.maxOutputBytes },
      )
      return {
        exitCode: result.exitCode,
        text: () => result.stdout.toString("utf8"),
        truncated: result.stdoutTruncated || result.stderrTruncated,
      }
    },
    Effect.orElseSucceed(() => ({ exitCode: 1, text: () => "", truncated: false })),
  )

  const status = Effect.fn("VcsHg.statusNames")(function* (rev: string | undefined, scope: string) {
    const result = yield* run(["status", "-0", ...(rev ? ["--rev", rev] : []), scope])
    if (result.exitCode !== 0) return []
    return result
      .text()
      .split("\0")
      .filter(Boolean)
      .flatMap((entry) => {
        const code = entry.slice(0, 1)
        const file = entry.slice(2)
        if (!file) return []
        return [{ file, code, status: kind(code) } satisfies Item]
      })
  })

  const diff = Effect.fn("VcsHg.diffPatch")(function* (
    rev: string | undefined,
    scope: string,
    options: { context: number },
  ) {
    const result = yield* run(
      ["diff", "--git", "--unified", String(options.context), ...(rev ? ["-r", rev] : []), scope],
      { maxOutputBytes: MAX_TOTAL_PATCH_BYTES },
    )
    if (result.exitCode !== 0) return { text: "", truncated: false }
    return { text: result.text(), truncated: result.truncated }
  })

  const branch = Effect.fn("VcsHg.branch")(function* () {
    const result = yield* run(["branch"])
    if (result.exitCode !== 0) return undefined
    return result.text().trim() || undefined
  })

  const ancestor = Effect.fn("VcsHg.ancestor")(function* () {
    const result = yield* run(["log", "-r", "ancestor(., default)", "-T", "{node}"])
    if (result.exitCode !== 0) return undefined
    return result.text().trim() || undefined
  })

  const cat = Effect.fn("VcsHg.cat")(function* (rev: string, file: string) {
    const result = yield* run(["cat", "-r", rev, "--", file], { maxOutputBytes: MAX_PATCH_BYTES })
    if (result.exitCode !== 0 || result.truncated) return undefined
    return result.text()
  })

  return { status, diff, branch, ancestor, cat }
}
