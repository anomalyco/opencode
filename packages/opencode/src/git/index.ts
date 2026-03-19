import { Effect, Layer, ServiceMap } from "effect"
import { Process } from "@/util/process"

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

function out(result: { text(): string }) {
  return result.text().trim()
}

function split(text: string) {
  return text.split("\0").filter(Boolean)
}

export namespace Git {
  export type Kind = "added" | "deleted" | "modified"

  export type Base = {
    readonly name: string
    readonly ref: string
  }

  export type Item = {
    readonly file: string
    readonly code: string
    readonly status: Kind
  }

  export type Stat = {
    readonly file: string
    readonly additions: number
    readonly deletions: number
  }

  export interface Result {
    readonly exitCode: number
    readonly text: () => string
    readonly stdout: Buffer
    readonly stderr: Buffer
  }

  export interface Options {
    readonly cwd: string
    readonly env?: Record<string, string>
  }

  function kind(code: string | undefined): Kind {
    if (code === "??") return "added"
    if (code?.includes("U")) return "modified"
    if (code?.includes("A") && !code.includes("D")) return "added"
    if (code?.includes("D") && !code.includes("A")) return "deleted"
    return "modified"
  }

  function parseStatus(text: string) {
    return split(text).flatMap((item) => {
      const file = item.slice(3)
      if (!file) return []
      const code = item.slice(0, 2)
      return [{ file, code, status: kind(code) } satisfies Item]
    })
  }

  function parseNames(text: string) {
    const list = split(text)
    const out: Item[] = []
    for (let i = 0; i < list.length; i += 2) {
      const code = list[i]
      const file = list[i + 1]
      if (!code || !file) continue
      out.push({ file, code, status: kind(code) })
    }
    return out
  }

  function parseStats(text: string) {
    const out: Stat[] = []
    for (const item of split(text)) {
      const a = item.indexOf("\t")
      const b = item.indexOf("\t", a + 1)
      if (a === -1 || b === -1) continue
      const file = item.slice(b + 1)
      if (!file) continue
      const adds = item.slice(0, a)
      const dels = item.slice(a + 1, b)
      const additions = adds === "-" ? 0 : Number.parseInt(adds || "0", 10)
      const deletions = dels === "-" ? 0 : Number.parseInt(dels || "0", 10)
      out.push({
        file,
        additions: Number.isFinite(additions) ? additions : 0,
        deletions: Number.isFinite(deletions) ? deletions : 0,
      })
    }
    return out
  }

  async function refs(cwd: string) {
    return lines(["for-each-ref", "--format=%(refname:short)", "refs/heads"], { cwd })
  }

  async function configured(cwd: string, list: string[]) {
    const result = await run(["config", "init.defaultBranch"], { cwd })
    if (result.exitCode !== 0) return
    const name = out(result)
    if (!name || !list.includes(name)) return
    const ref = await run(["rev-parse", "--verify", name], { cwd })
    if (ref.exitCode !== 0) return
    return { name, ref: name } satisfies Base
  }

  async function remoteHead(cwd: string, remote: string) {
    const result = await run(["ls-remote", "--symref", remote, "HEAD"], { cwd })
    if (result.exitCode !== 0) return
    for (const line of result.text().split("\n")) {
      const match = /^ref: refs\/heads\/(.+)\tHEAD$/.exec(line.trim())
      if (!match?.[1]) continue
      return { name: match[1], ref: `${remote}/${match[1]}` } satisfies Base
    }
  }

  async function primary(cwd: string) {
    const list = await lines(["remote"], { cwd })
    if (list.includes("origin")) return "origin"
    if (list.length === 1) return list[0]
    if (list.includes("upstream")) return "upstream"
    return list[0]
  }

  export interface Interface {
    readonly run: (args: string[], opts: Options) => Effect.Effect<Result>
    readonly text: (args: string[], opts: Options) => Effect.Effect<string>
    readonly lines: (args: string[], opts: Options) => Effect.Effect<string[]>
    readonly branch: (cwd: string) => Effect.Effect<string | undefined>
    readonly prefix: (cwd: string) => Effect.Effect<string>
    readonly defaultBranch: (cwd: string) => Effect.Effect<Base | undefined>
    readonly hasHead: (cwd: string) => Effect.Effect<boolean>
    readonly mergeBase: (cwd: string, base: string, head?: string) => Effect.Effect<string | undefined>
    readonly show: (cwd: string, ref: string, file: string, prefix?: string) => Effect.Effect<string>
    readonly status: (cwd: string) => Effect.Effect<Item[]>
    readonly diff: (cwd: string, ref: string) => Effect.Effect<Item[]>
    readonly stats: (cwd: string, ref: string) => Effect.Effect<Stat[]>
  }

  export async function run(args: string[], opts: Options): Promise<Result> {
    return Process.run(["git", ...cfg, ...args], {
      cwd: opts.cwd,
      env: opts.env,
      stdin: "ignore",
      nothrow: true,
    })
      .then((result) => ({
        exitCode: result.code,
        text: () => result.stdout.toString(),
        stdout: result.stdout,
        stderr: result.stderr,
      }))
      .catch((error) => ({
        exitCode: 1,
        text: () => "",
        stdout: Buffer.alloc(0),
        stderr: Buffer.from(error instanceof Error ? error.message : String(error)),
      }))
  }

  export async function text(args: string[], opts: Options) {
    return (await run(args, opts)).text()
  }

  export async function lines(args: string[], opts: Options) {
    return (await text(args, opts))
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean)
  }

  export async function branch(cwd: string) {
    const result = await run(["rev-parse", "--abbrev-ref", "HEAD"], { cwd })
    if (result.exitCode !== 0) return
    const text = out(result)
    return text || undefined
  }

  export async function prefix(cwd: string) {
    const result = await run(["rev-parse", "--show-prefix"], { cwd })
    if (result.exitCode !== 0) return ""
    return out(result)
  }

  export async function defaultBranch(cwd: string) {
    const remote = await primary(cwd)
    if (remote) {
      const head = await run(["symbolic-ref", `refs/remotes/${remote}/HEAD`], { cwd })
      if (head.exitCode === 0) {
        const ref = out(head).replace(/^refs\/remotes\//, "")
        const name = ref.startsWith(`${remote}/`) ? ref.slice(`${remote}/`.length) : ""
        if (name) return { name, ref } satisfies Base
      }

      const next = await remoteHead(cwd, remote)
      if (next) return next
    }

    const list = await refs(cwd)
    const next = await configured(cwd, list)
    if (next) return next
    for (const name of ["main", "master"]) {
      if (list.includes(name)) return { name, ref: name } satisfies Base
    }
  }

  export async function hasHead(cwd: string) {
    const result = await run(["rev-parse", "--verify", "HEAD"], { cwd })
    return result.exitCode === 0
  }

  export async function mergeBase(cwd: string, base: string, head = "HEAD") {
    const result = await run(["merge-base", base, head], { cwd })
    if (result.exitCode !== 0) return
    const text = out(result)
    return text || undefined
  }

  export async function show(cwd: string, ref: string, file: string, prefix = "") {
    const target = prefix ? `${prefix}${file}` : file
    const result = await run(["show", `${ref}:${target}`], { cwd })
    if (result.exitCode !== 0) return ""
    return result.text()
  }

  export async function status(cwd: string) {
    return parseStatus(await text(["status", "--porcelain=v1", "--untracked-files=all", "--no-renames", "-z", "--", "."], { cwd }))
  }

  export async function diff(cwd: string, ref: string) {
    return parseNames(await text(["diff", "--no-ext-diff", "--no-renames", "--name-status", "-z", ref, "--", "."], { cwd }))
  }

  export async function stats(cwd: string, ref: string) {
    return parseStats(await text(["diff", "--no-ext-diff", "--no-renames", "--numstat", "-z", ref, "--", "."], { cwd }))
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/Git") {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const fxRun = Effect.fn("Git.run")(function* (args: string[], opts: Options) {
        return yield* Effect.promise(() => run(args, opts))
      })

      const fxText = Effect.fn("Git.text")(function* (args: string[], opts: Options) {
        return yield* Effect.promise(() => text(args, opts))
      })

      const fxLines = Effect.fn("Git.lines")(function* (args: string[], opts: Options) {
        return yield* Effect.promise(() => lines(args, opts))
      })

      const fxBranch = Effect.fn("Git.branch")(function* (cwd: string) {
        return yield* Effect.promise(() => branch(cwd))
      })

      const fxPrefix = Effect.fn("Git.prefix")(function* (cwd: string) {
        return yield* Effect.promise(() => prefix(cwd))
      })

      const fxDefaultBranch = Effect.fn("Git.defaultBranch")(function* (cwd: string) {
        return yield* Effect.promise(() => defaultBranch(cwd))
      })

      const fxHasHead = Effect.fn("Git.hasHead")(function* (cwd: string) {
        return yield* Effect.promise(() => hasHead(cwd))
      })

      const fxMergeBase = Effect.fn("Git.mergeBase")(function* (cwd: string, base: string, head?: string) {
        return yield* Effect.promise(() => mergeBase(cwd, base, head))
      })

      const fxShow = Effect.fn("Git.show")(function* (cwd: string, ref: string, file: string, prefix?: string) {
        return yield* Effect.promise(() => show(cwd, ref, file, prefix))
      })

      const fxStatus = Effect.fn("Git.status")(function* (cwd: string) {
        return yield* Effect.promise(() => status(cwd))
      })

      const fxDiff = Effect.fn("Git.diff")(function* (cwd: string, ref: string) {
        return yield* Effect.promise(() => diff(cwd, ref))
      })

      const fxStats = Effect.fn("Git.stats")(function* (cwd: string, ref: string) {
        return yield* Effect.promise(() => stats(cwd, ref))
      })

      return Service.of({
        run: fxRun,
        text: fxText,
        lines: fxLines,
        branch: fxBranch,
        prefix: fxPrefix,
        defaultBranch: fxDefaultBranch,
        hasHead: fxHasHead,
        mergeBase: fxMergeBase,
        show: fxShow,
        status: fxStatus,
        diff: fxDiff,
        stats: fxStats,
      })
    }),
  )
}
