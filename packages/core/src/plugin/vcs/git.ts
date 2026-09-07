export * as VcsGitPlugin from "./git.js"

import { define } from "@opencode-ai/plugin/effect/plugin"
import { Effect } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { FileDiff } from "@opencode-ai/schema/file-diff"
import { Base, BranchList, FileStatus, Info, Mode } from "@opencode-ai/schema/vcs"
import { AppProcess } from "@opencode-ai/util/process"
import { Location } from "../../location.js"
import type { Adapter, BranchOptions, DiffOptions } from "../../vcs.js"
import { DiffError } from "../../vcs.js"
import {
  chunksByFile,
  emptyPatch,
  MAX_PATCH_BYTES,
  MAX_TOTAL_PATCH_BYTES,
  PATCH_CONTEXT_LINES,
} from "../../vcs/patch.js"
import type { Patch } from "../../vcs/patch.js"

export const Plugin = define({
  id: "opencode.vcs.git",
  effect: Effect.fn("VcsGitPlugin")(function* (ctx) {
    const location = yield* Location.Service
    if (location.vcs?.type !== "git") return

    const processes = yield* AppProcess.Service
    const adapter = make(processes, {
      directory: location.directory,
      worktree: location.project.directory,
    })

    yield* ctx.vcs.transform((editor) => {
      editor.add({
        id: "git",
        name: "Git",
        info: () => adapter.info(),
        base: () => adapter.base(),
        branches: (input) => adapter.branches({ search: input.search, limit: input.limit }),
        status: () => adapter.status(),
        diff: (input) => adapter.diff(input.mode, { context: input.context, base: input.base }),
      })
    })
  }),
})

/**
 * Git adapter for the Vcs service. Ported from the V1 pipeline: patches are
 * batched through one `git diff` invocation where possible and capped by
 * per-file and total byte budgets, falling back to empty patches when capped.
 */
function make(proc: AppProcess.Interface, input: { directory: string; worktree: string }) {
  // Listing commands scope pathspecs to the requested directory; per-file
  // commands run from the worktree root because git lists root-relative paths.
  const ctx: Ctx = { git: makeGit(proc), directory: input.directory, worktree: input.worktree }

  return {
    info: Effect.fn("VcsGit.info")(function* () {
      const [current, root] = yield* Effect.all([ctx.git.branch(ctx.directory), ctx.git.defaultBranch(ctx.directory)], {
        concurrency: 2,
      })
      return { branch: { current, default: root?.name } } satisfies Info
    }),
    base: () => ctx.git.base(ctx.directory),
    branches: Effect.fn("VcsGit.branches")(function* (options?: BranchOptions) {
      return yield* ctx.git.branches(ctx.directory, options)
    }),
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

      if (!(yield* git.hasHead(ctx.directory))) {
        return mode === "committed" ? [] : yield* track(ctx, undefined, options)
      }
      const base = options?.base ?? (yield* git.defaultBranch(ctx.directory))?.ref
      const ref = base ? yield* git.mergeBase(ctx.directory, base) : undefined
      if (!ref) {
        return yield* new DiffError({
          message: base ? `No merge base available for ${base}` : "No review base available",
        })
      }
      return yield* diffAgainstRef(ctx, ref, { ...options, target: mode === "committed" ? "HEAD" : undefined })
    }),
  } satisfies Adapter
}

type Kind = FileStatus["status"]

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

interface GitDiffOptions extends DiffOptions {
  readonly target?: "HEAD"
}

interface PatchOptions extends GitDiffOptions {
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
    Effect.orElseSucceed(() => ({ exitCode: 1, text: () => "", truncated: false })),
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
    return { name, ref: name }
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

  const branches = Effect.fn("VcsGit.branches")(function* (cwd: string, options?: BranchOptions) {
    const search = options?.search?.trim().replace(/[*?[\]\\]/g, "\\$&")
    return (yield* lines(
      [
        "for-each-ref",
        "--ignore-case",
        "--sort=refname",
        "--sort=-committerdate",
        "--format=%(refname:short)",
        ...(options?.limit ? [`--count=${options.limit}`] : []),
        ...(search ? [`refs/heads/*${search}*`, `refs/remotes/*${search}*`] : ["refs/heads", "refs/remotes"]),
      ],
      { cwd },
    )).filter((item) => !item.endsWith("/HEAD")) satisfies BranchList
  })

  const defaultBranch = Effect.fn("VcsGit.defaultBranch")(function* (cwd: string) {
    const remote = yield* primary(cwd)
    if (remote) {
      const head = yield* run(["symbolic-ref", `refs/remotes/${remote}/HEAD`], { cwd })
      if (head.exitCode === 0) {
        const ref = head
          .text()
          .trim()
          .replace(/^refs\/remotes\//, "")
        const name = ref.startsWith(`${remote}/`) ? ref.slice(`${remote}/`.length) : ""
        if (name) return { name, ref }
      }
    }

    const list = yield* lines(["for-each-ref", "--format=%(refname:short)", "refs/heads"], { cwd })
    const next = yield* configured(cwd, list)
    if (next) return next
    if (list.includes("main")) return { name: "main", ref: "main" }
    if (list.includes("master")) return { name: "master", ref: "master" }
  })

  const resolve = Effect.fnUntraced(function* (cwd: string, ref: string) {
    const result = yield* run(["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`], { cwd })
    if (result.exitCode !== 0) return
    return result.text().trim() || undefined
  })

  const ancestor = Effect.fnUntraced(function* (cwd: string, commit: string, ref: string) {
    if (!/^[a-f0-9]{40,64}$/.test(commit)) return false
    return (yield* run(["merge-base", "--is-ancestor", commit, ref], { cwd })).exitCode === 0
  })

  const namedRef = Effect.fnUntraced(function* (cwd: string, input: string) {
    // Creation hints must identify a branch, not HEAD, an object ID, or a revision expression.
    if (input === "HEAD" || input.endsWith("/HEAD") || /[~^:@{}\s]/.test(input)) return
    const ref = (yield* text(["rev-parse", "--symbolic-full-name", "--verify", "--end-of-options", input], {
      cwd,
    })).trim()
    if (!/^refs\/(heads|remotes)\/.+/.test(ref) || ref.endsWith("/HEAD") || !(yield* resolve(cwd, ref))) return
    return { name: ref.replace(/^refs\/heads\//, "").replace(/^refs\/remotes\/[^/]+\//, ""), ref }
  })

  const base = Effect.fn("VcsGit.base")(function* (cwd: string) {
    if (!(yield* hasHead(cwd))) return null
    const current = yield* branch(cwd)
    if (!current) return yield* new DiffError({ message: "Choose a review base" })
    const history = (yield* lines(
      ["reflog", "show", "--max-count=256", "--format=%H%x00%gs", `refs/heads/${current}`],
      {
        cwd,
      },
    )).flatMap((line) => {
      const match = /^([a-f0-9]+)\0(.+)$/.exec(line)
      return match ? [{ commit: match[1], message: match[2] }] : []
    })
    const renamed = history.some((entry) => entry.message.startsWith("Branch: renamed "))
    const creation = renamed ? undefined : history.find((entry) => entry.message.startsWith("branch: Created from "))
    const origin = creation?.message.slice("branch: Created from ".length)
    if (creation && origin) {
      const candidate = yield* namedRef(cwd, origin)
      if (
        candidate &&
        candidate.name !== current &&
        (yield* ancestor(cwd, creation.commit, "HEAD")) &&
        (yield* ancestor(cwd, creation.commit, candidate.ref))
      ) {
        return { ...candidate, source: "reflog" } satisfies Base
      }
    }
    const root = yield* defaultBranch(cwd)
    if (!root || current !== root.name) return yield* new DiffError({ message: "Choose a review base" })
    const candidate = yield* namedRef(cwd, root.ref)
    if (!candidate) return yield* new DiffError({ message: "The default review base is unavailable" })
    return { name: root.name, ref: candidate.ref, source: "default" } satisfies Base
  })

  const hasHead = Effect.fn("VcsGit.hasHead")(function* (cwd: string) {
    const result = yield* run(["rev-parse", "--verify", "HEAD"], { cwd })
    return result.exitCode === 0
  })

  const mergeBase = Effect.fn("VcsGit.mergeBase")(function* (cwd: string, base: string) {
    const ref = yield* resolve(cwd, base)
    if (!ref) return
    const result = yield* run(["merge-base", ref, "HEAD"], { cwd })
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

  const diff = Effect.fn("VcsGit.diffNames")(function* (cwd: string, ref: string, target?: string) {
    const result = yield* run(
      ["diff", "--no-ext-diff", "--no-renames", "--name-status", "-z", ref, ...(target ? [target] : []), "--", "."],
      { cwd },
    )
    if (result.exitCode !== 0) return yield* new DiffError({ message: "Unable to list Git changes" })
    const list = nuls(result.text())
    return list.flatMap((code, idx) => {
      if (idx % 2 !== 0) return []
      const file = list[idx + 1]
      if (!code || !file) return []
      return [{ file, code, status: kind(code) } satisfies Item]
    })
  })

  const stats = Effect.fn("VcsGit.stats")(function* (cwd: string, ref: string, target?: string) {
    return nuls(
      yield* text(
        ["diff", "--no-ext-diff", "--no-renames", "--numstat", "-z", ref, ...(target ? [target] : []), "--", "."],
        { cwd },
      ),
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
      [
        "diff",
        "--patch",
        "--no-ext-diff",
        "--no-renames",
        `--unified=${options?.context ?? 3}`,
        ref,
        ...(options?.target ? [options.target] : []),
        "--",
        file,
      ],
      { cwd, maxOutputBytes: options?.maxOutputBytes },
    )
    return { text: result.truncated ? "" : result.text(), truncated: result.truncated } satisfies Patch
  })

  const patchAll = Effect.fn("VcsGit.patchAll")(function* (cwd: string, ref: string, options?: PatchOptions) {
    const result = yield* run(
      [
        "diff",
        "--patch",
        "--no-ext-diff",
        "--no-renames",
        `--unified=${options?.context ?? 3}`,
        ref,
        ...(options?.target ? [options.target] : []),
        "--",
        ".",
      ],
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
    branches,
    base,
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

const batchPatches = Effect.fnUntraced(function* (ctx: Ctx, ref: string, list: Item[], options?: GitDiffOptions) {
  if (list.length === 0) return emptyBatch()

  const result = yield* ctx.git.patchAll(ctx.directory, ref, {
    target: options?.target,
    context: options?.context ?? PATCH_CONTEXT_LINES,
    maxOutputBytes: MAX_TOTAL_PATCH_BYTES,
  })

  return {
    patches: chunksByFile(result, (index) => list[index]?.file),
    capped: result.truncated,
  }
})

const nativePatch = Effect.fnUntraced(function* (
  ctx: Ctx,
  ref: string | undefined,
  item: Item,
  options?: GitDiffOptions,
) {
  const result =
    item.code === "??" || !ref
      ? yield* ctx.git.patchUntracked(ctx.worktree, item.file, {
          context: options?.context ?? PATCH_CONTEXT_LINES,
          maxOutputBytes: MAX_PATCH_BYTES,
        })
      : yield* ctx.git.patch(ctx.worktree, ref, item.file, {
          target: options?.target,
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
  options?: GitDiffOptions,
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
  options?: GitDiffOptions,
) {
  const next: FileDiff.Info[] = []
  let total = 0
  let capped = false

  for (const item of list.toSorted((a, b) => a.file.localeCompare(b.file))) {
    const stat =
      map.get(item.file) ??
      (!options?.target && item.status === "added" ? yield* ctx.git.statUntracked(ctx.worktree, item.file) : undefined)
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

const diffAgainstRef = Effect.fnUntraced(function* (ctx: Ctx, ref: string, options?: GitDiffOptions) {
  const [list, stats, extra] = yield* Effect.all(
    [
      ctx.git.diff(ctx.directory, ref, options?.target),
      ctx.git.stats(ctx.directory, ref, options?.target),
      options?.target ? Effect.succeed([]) : ctx.git.status(ctx.directory),
    ],
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
