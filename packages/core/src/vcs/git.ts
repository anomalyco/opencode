export * as VcsGit from "./git"

import { Effect } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { FileDiff } from "@opencode-ai/schema/file-diff"
import { FileStatus, Mode } from "@opencode-ai/schema/vcs"
import { AppProcess } from "../process"
import type { DiffOptions, Interface } from "../vcs"
import { chunksByFile, emptyPatch, MAX_PATCH_BYTES, MAX_TOTAL_PATCH_BYTES, PATCH_CONTEXT_LINES } from "./patch"
import type { Patch } from "./patch"

/**
 * Git adapter for the Vcs service. Ported from the V1 pipeline: patches are
 * batched through one `git diff` invocation where possible and capped by
 * per-file and total byte budgets, falling back to empty patches when capped.
 */
export function make(proc: AppProcess.Interface, input: { directory: string; worktree: string }): Interface {
  // Listing commands scope pathspecs to the requested directory; per-file
  // commands run from the worktree root because git lists root-relative paths.
  const ctx: Ctx = { git: makeGit(proc), directory: input.directory, worktree: input.worktree }

  return {
    status: Effect.fn("VcsGit.status")(function* () {
      const git = ctx.git
      const ref = (yield* git.hasHead(ctx.directory)) ? "HEAD" : undefined
      const [list, stats] = yield* Effect.all(
        [git.status(ctx.directory), ref ? git.stats(ctx.directory, ref) : Effect.succeed([] as Stat[])],
        { concurrency: 2 },
      )
      const map = nums(stats)
      return yield* Effect.forEach(
        list.toSorted((a, b) => a.file.localeCompare(b.file)),
        (item) =>
          Effect.gen(function* () {
            const stat =
              map.get(item.file) ??
              (item.status === "added" ? yield* git.statUntracked(ctx.worktree, item.file) : undefined)
            return {
              file: item.file,
              additions: stat?.additions ?? 0,
              deletions: stat?.deletions ?? 0,
              status: item.status,
            } satisfies FileStatus
          }),
      )
    }),
    diff: Effect.fn("VcsGit.diff")(function* (mode: Mode, options?: DiffOptions) {
      const git = ctx.git
      if (mode === "working") {
        return yield* track(ctx, (yield* git.hasHead(ctx.directory)) ? "HEAD" : undefined, options)
      }

      const [current, root] = yield* Effect.all([git.branch(ctx.directory), git.defaultBranch(ctx.directory)], {
        concurrency: 2,
      })
      if (!root) return []
      if (current && current === root.name) return []
      const ref = yield* git.mergeBase(ctx.directory, root.ref)
      if (!ref) return []
      return yield* diffAgainstRef(ctx, ref, options)
    }),
  }
}

type Kind = FileStatus["status"]

interface Base {
  readonly name: string
  readonly ref: string
}

interface Item {
  readonly file: string
  readonly code: string
  readonly status: Kind
}

interface Stat {
  readonly file: string
  readonly additions: number
  readonly deletions: number
}

interface PatchOptions {
  readonly context?: number
  readonly maxOutputBytes?: number
}

interface Ctx {
  readonly git: GitOps
  readonly directory: string
  readonly worktree: string
}

type GitOps = ReturnType<typeof makeGit>

const cfg = [
  "--no-optional-locks",
  "-c",
  "core.autocrlf=false",
  "-c",
  "core.fsmonitor=false",
  "-c",
  "core.longpaths=true",
  "-c",
  "core.symlinks=true",
  "-c",
  "core.quotepath=false",
] as const

const kind = (code: string): Kind => {
  if (code === "??") return "added"
  if (code.includes("U")) return "modified"
  if (code.includes("A") && !code.includes("D")) return "added"
  if (code.includes("D") && !code.includes("A")) return "deleted"
  return "modified"
}

const nuls = (text: string) => text.split("\0").filter(Boolean)

function makeGit(proc: AppProcess.Interface) {
  const run = Effect.fnUntraced(
    function* (args: string[], opts: { cwd: string; maxOutputBytes?: number }) {
      const result = yield* proc.run(
        ChildProcess.make("git", [...cfg, ...args], {
          cwd: opts.cwd,
          extendEnv: true,
          stdin: "ignore",
        }),
        { maxOutputBytes: opts.maxOutputBytes },
      )
      return {
        exitCode: result.exitCode,
        text: () => result.stdout.toString("utf8"),
        truncated: result.stdoutTruncated || result.stderrTruncated,
      }
    },
    Effect.catch(() => Effect.succeed({ exitCode: 1, text: () => "", truncated: false })),
  )

  const text = Effect.fnUntraced(function* (args: string[], opts: { cwd: string }) {
    return (yield* run(args, opts)).text()
  })

  const lines = Effect.fnUntraced(function* (args: string[], opts: { cwd: string }) {
    return (yield* text(args, opts))
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean)
  })

  const configured = Effect.fnUntraced(function* (cwd: string, list: string[]) {
    const result = yield* run(["config", "init.defaultBranch"], { cwd })
    const name = result.text().trim()
    if (!name || !list.includes(name)) return
    return { name, ref: name } satisfies Base
  })

  const primary = Effect.fnUntraced(function* (cwd: string) {
    const list = yield* lines(["remote"], { cwd })
    if (list.includes("origin")) return "origin"
    if (list.length === 1) return list[0]
    if (list.includes("upstream")) return "upstream"
    return list[0]
  })

  const branch = Effect.fn("VcsGit.branch")(function* (cwd: string) {
    const result = yield* run(["symbolic-ref", "--quiet", "--short", "HEAD"], { cwd })
    if (result.exitCode !== 0) return
    return result.text().trim() || undefined
  })

  const defaultBranch = Effect.fn("VcsGit.defaultBranch")(function* (cwd: string) {
    const remote = yield* primary(cwd)
    if (remote) {
      const head = yield* run(["symbolic-ref", `refs/remotes/${remote}/HEAD`], { cwd })
      if (head.exitCode === 0) {
        const ref = head.text().trim().replace(/^refs\/remotes\//, "")
        const name = ref.startsWith(`${remote}/`) ? ref.slice(`${remote}/`.length) : ""
        if (name) return { name, ref } satisfies Base
      }
    }

    const list = yield* lines(["for-each-ref", "--format=%(refname:short)", "refs/heads"], { cwd })
    const next = yield* configured(cwd, list)
    if (next) return next
    if (list.includes("main")) return { name: "main", ref: "main" } satisfies Base
    if (list.includes("master")) return { name: "master", ref: "master" } satisfies Base
  })

  const hasHead = Effect.fn("VcsGit.hasHead")(function* (cwd: string) {
    const result = yield* run(["rev-parse", "--verify", "HEAD"], { cwd })
    return result.exitCode === 0
  })

  const mergeBase = Effect.fn("VcsGit.mergeBase")(function* (cwd: string, base: string) {
    const result = yield* run(["merge-base", base, "HEAD"], { cwd })
    if (result.exitCode !== 0) return
    return result.text().trim() || undefined
  })

  const status = Effect.fn("VcsGit.statusNames")(function* (cwd: string) {
    return nuls(
      yield* text(["status", "--porcelain=v1", "--untracked-files=all", "--no-renames", "-z", "--", "."], { cwd }),
    ).flatMap((item) => {
      const file = item.slice(3)
      if (!file) return []
      const code = item.slice(0, 2)
      return [{ file, code, status: kind(code) } satisfies Item]
    })
  })

  const diff = Effect.fn("VcsGit.diffNames")(function* (cwd: string, ref: string) {
    const list = nuls(
      yield* text(["diff", "--no-ext-diff", "--no-renames", "--name-status", "-z", ref, "--", "."], { cwd }),
    )
    return list.flatMap((code, idx) => {
      if (idx % 2 !== 0) return []
      const file = list[idx + 1]
      if (!code || !file) return []
      return [{ file, code, status: kind(code) } satisfies Item]
    })
  })

  const stats = Effect.fn("VcsGit.stats")(function* (cwd: string, ref: string) {
    return nuls(
      yield* text(["diff", "--no-ext-diff", "--no-renames", "--numstat", "-z", ref, "--", "."], { cwd }),
    ).flatMap((item) => {
      const a = item.indexOf("\t")
      const b = item.indexOf("\t", a + 1)
      if (a === -1 || b === -1) return []
      const file = item.slice(b + 1)
      if (!file) return []
      const adds = item.slice(0, a)
      const dels = item.slice(a + 1, b)
      const additions = adds === "-" ? 0 : Number.parseInt(adds || "0", 10)
      const deletions = dels === "-" ? 0 : Number.parseInt(dels || "0", 10)
      return [
        {
          file,
          additions: Number.isFinite(additions) ? additions : 0,
          deletions: Number.isFinite(deletions) ? deletions : 0,
        } satisfies Stat,
      ]
    })
  })

  const patch = Effect.fn("VcsGit.patch")(function* (cwd: string, ref: string, file: string, options?: PatchOptions) {
    const result = yield* run(
      ["diff", "--patch", "--no-ext-diff", "--no-renames", `--unified=${options?.context ?? 3}`, ref, "--", file],
      { cwd, maxOutputBytes: options?.maxOutputBytes },
    )
    return { text: result.truncated ? "" : result.text(), truncated: result.truncated } satisfies Patch
  })

  const patchAll = Effect.fn("VcsGit.patchAll")(function* (cwd: string, ref: string, options?: PatchOptions) {
    const result = yield* run(
      ["diff", "--patch", "--no-ext-diff", "--no-renames", `--unified=${options?.context ?? 3}`, ref, "--", "."],
      { cwd, maxOutputBytes: options?.maxOutputBytes },
    )
    return { text: result.text(), truncated: result.truncated } satisfies Patch
  })

  const patchUntracked = Effect.fn("VcsGit.patchUntracked")(function* (
    cwd: string,
    file: string,
    options?: PatchOptions,
  ) {
    const result = yield* run(
      [
        "diff",
        "--no-index",
        "--patch",
        "--no-ext-diff",
        "--no-renames",
        `--unified=${options?.context ?? 3}`,
        "--",
        "/dev/null",
        file,
      ],
      { cwd, maxOutputBytes: options?.maxOutputBytes },
    )
    return { text: result.truncated ? "" : result.text(), truncated: result.truncated } satisfies Patch
  })

  const statUntracked = Effect.fn("VcsGit.statUntracked")(function* (cwd: string, file: string) {
    const result = yield* run(["diff", "--no-index", "--numstat", "--", "/dev/null", file], {
      cwd,
      maxOutputBytes: 4096,
    })
    if (result.truncated) return

    const parts = result.text().split("\t")
    if (parts.length < 2) return

    const additions = parts[0] === "-" ? 0 : Number.parseInt(parts[0] || "0", 10)
    const deletions = parts[1] === "-" ? 0 : Number.parseInt(parts[1] || "0", 10)
    return {
      file,
      additions: Number.isFinite(additions) ? additions : 0,
      deletions: Number.isFinite(deletions) ? deletions : 0,
    } satisfies Stat
  })

  return {
    branch,
    defaultBranch,
    hasHead,
    mergeBase,
    status,
    diff,
    stats,
    patch,
    patchAll,
    patchUntracked,
    statUntracked,
  }
}

const nums = (list: Stat[]) =>
  new Map(list.map((item) => [item.file, { additions: item.additions, deletions: item.deletions }] as const))

const merge = (...lists: Item[][]) => {
  const out = new Map<string, Item>()
  lists.flat().forEach((item) => {
    if (!out.has(item.file)) out.set(item.file, item)
  })
  return [...out.values()]
}

const emptyBatch = () => ({ patches: new Map<string, string>(), capped: false })

const batchPatches = Effect.fnUntraced(function* (ctx: Ctx, ref: string, list: Item[], options?: DiffOptions) {
  if (list.length === 0) return emptyBatch()

  const result = yield* ctx.git.patchAll(ctx.directory, ref, {
    context: options?.context ?? PATCH_CONTEXT_LINES,
    maxOutputBytes: MAX_TOTAL_PATCH_BYTES,
  })

  return {
    patches: chunksByFile(result, (index) => list[index]?.file),
    capped: result.truncated,
  }
})

const nativePatch = Effect.fnUntraced(function* (ctx: Ctx, ref: string | undefined, item: Item, options?: DiffOptions) {
  const result =
    item.code === "??" || !ref
      ? yield* ctx.git.patchUntracked(ctx.worktree, item.file, {
          context: options?.context ?? PATCH_CONTEXT_LINES,
          maxOutputBytes: MAX_PATCH_BYTES,
        })
      : yield* ctx.git.patch(ctx.worktree, ref, item.file, {
          context: options?.context ?? PATCH_CONTEXT_LINES,
          maxOutputBytes: MAX_PATCH_BYTES,
        })
  if (!result.truncated && result.text) return result.text

  return emptyPatch(item.file)
})

const totalPatch = (file: string, patch: string, total: number) => {
  if (total + Buffer.byteLength(patch) <= MAX_TOTAL_PATCH_BYTES) return { patch, capped: false }
  return { patch: emptyPatch(file), capped: true }
}

const patchForItem = Effect.fnUntraced(function* (
  ctx: Ctx,
  ref: string | undefined,
  item: Item,
  batch: { patches: Map<string, string>; capped: boolean },
  capped: boolean,
  options?: DiffOptions,
) {
  if (capped) return emptyPatch(item.file)

  const batched = batch.patches.get(item.file)
  if (batched !== undefined) return batched
  if (item.code !== "??" && batch.capped) return emptyPatch(item.file)
  return yield* nativePatch(ctx, ref, item, options)
})

const files = Effect.fnUntraced(function* (
  ctx: Ctx,
  ref: string | undefined,
  list: Item[],
  map: Map<string, { additions: number; deletions: number }>,
  batch: { patches: Map<string, string>; capped: boolean },
  options?: DiffOptions,
) {
  const next: FileDiff.Info[] = []
  let total = 0
  let capped = false

  for (const item of list.toSorted((a, b) => a.file.localeCompare(b.file))) {
    const stat =
      map.get(item.file) ??
      (item.status === "added" ? yield* ctx.git.statUntracked(ctx.worktree, item.file) : undefined)
    const patch = yield* patchForItem(ctx, ref, item, batch, capped, options)
    const result: { patch: string; capped: boolean } = capped
      ? { patch, capped: true }
      : totalPatch(item.file, patch, total)
    capped = capped || result.capped
    if (!capped) {
      total += Buffer.byteLength(result.patch)
      capped = total >= MAX_TOTAL_PATCH_BYTES
    }
    next.push({
      file: item.file,
      patch: result.patch,
      additions: stat?.additions ?? 0,
      deletions: stat?.deletions ?? 0,
      status: item.status,
    })
  }

  return next
})

const diffAgainstRef = Effect.fnUntraced(function* (ctx: Ctx, ref: string, options?: DiffOptions) {
  const [list, stats, extra] = yield* Effect.all(
    [ctx.git.diff(ctx.directory, ref), ctx.git.stats(ctx.directory, ref), ctx.git.status(ctx.directory)],
    { concurrency: 3 },
  )
  return yield* files(
    ctx,
    ref,
    merge(
      list,
      extra.filter((item) => item.code === "??"),
    ),
    nums(stats),
    yield* batchPatches(ctx, ref, list, options),
    options,
  )
})

const track = Effect.fnUntraced(function* (ctx: Ctx, ref: string | undefined, options?: DiffOptions) {
  if (!ref) return yield* files(ctx, ref, yield* ctx.git.status(ctx.directory), new Map(), emptyBatch(), options)
  return yield* diffAgainstRef(ctx, ref, options)
})
