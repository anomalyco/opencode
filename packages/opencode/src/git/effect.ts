import { NodeChildProcessSpawner, NodeFileSystem, NodePath } from "@effect/platform-node"
import { Effect, Layer, ServiceMap, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"

export namespace GitEffect {
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

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/Git") {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner

      const run = Effect.fn("Git.run")(
        function* (args: string[], opts: Options) {
          const proc = ChildProcess.make("git", [...cfg, ...args], {
            cwd: opts.cwd,
            env: opts.env,
            extendEnv: true,
          })
          const handle = yield* spawner.spawn(proc)
          const [stdout, stderr] = yield* Effect.all(
            [Stream.mkString(Stream.decodeText(handle.stdout)), Stream.mkString(Stream.decodeText(handle.stderr))],
            { concurrency: 2 },
          )
          return {
            exitCode: yield* handle.exitCode,
            text: () => stdout,
            stdout: Buffer.from(stdout),
            stderr: Buffer.from(stderr),
          } satisfies Result
        },
        Effect.scoped,
        Effect.catch((err) =>
          Effect.succeed({
            exitCode: ChildProcessSpawner.ExitCode(1),
            text: () => "",
            stdout: Buffer.alloc(0),
            stderr: Buffer.from(String(err)),
          }),
        ),
      )

      const text = Effect.fn("Git.text")(function* (args: string[], opts: Options) {
        return (yield* run(args, opts)).text()
      })

      const lines = Effect.fn("Git.lines")(function* (args: string[], opts: Options) {
        return (yield* text(args, opts))
          .split(/\r?\n/)
          .map((item) => item.trim())
          .filter(Boolean)
      })

      const refs = Effect.fnUntraced(function* (cwd: string) {
        return yield* lines(["for-each-ref", "--format=%(refname:short)", "refs/heads"], { cwd })
      })

      const configured = Effect.fnUntraced(function* (cwd: string, list: string[]) {
        const result = yield* run(["config", "init.defaultBranch"], { cwd })
        if (result.exitCode !== 0) return
        const name = out(result)
        if (!name || !list.includes(name)) return
        const ref = yield* run(["rev-parse", "--verify", name], { cwd })
        if (ref.exitCode !== 0) return
        return { name, ref: name } satisfies Base
      })

      const remoteHead = Effect.fnUntraced(function* (cwd: string, remote: string) {
        const result = yield* run(["ls-remote", "--symref", remote, "HEAD"], { cwd })
        if (result.exitCode !== 0) return
        for (const line of result.text().split("\n")) {
          const match = /^ref: refs\/heads\/(.+)\tHEAD$/.exec(line.trim())
          if (!match?.[1]) continue
          return { name: match[1], ref: `${remote}/${match[1]}` } satisfies Base
        }
      })

      const primary = Effect.fnUntraced(function* (cwd: string) {
        const list = yield* lines(["remote"], { cwd })
        if (list.includes("origin")) return "origin"
        if (list.length === 1) return list[0]
        if (list.includes("upstream")) return "upstream"
        return list[0]
      })

      const branch = Effect.fn("Git.branch")(function* (cwd: string) {
        const result = yield* run(["rev-parse", "--abbrev-ref", "HEAD"], { cwd })
        if (result.exitCode !== 0) return
        const text = out(result)
        return text || undefined
      })

      const prefix = Effect.fn("Git.prefix")(function* (cwd: string) {
        const result = yield* run(["rev-parse", "--show-prefix"], { cwd })
        if (result.exitCode !== 0) return ""
        return out(result)
      })

      const defaultBranch = Effect.fn("Git.defaultBranch")(function* (cwd: string) {
        const remote = yield* primary(cwd)
        if (remote) {
          const head = yield* run(["symbolic-ref", `refs/remotes/${remote}/HEAD`], { cwd })
          if (head.exitCode === 0) {
            const ref = out(head).replace(/^refs\/remotes\//, "")
            const name = ref.startsWith(`${remote}/`) ? ref.slice(`${remote}/`.length) : ""
            if (name) return { name, ref } satisfies Base
          }

          const next = yield* remoteHead(cwd, remote)
          if (next) return next
        }

        const list = yield* refs(cwd)
        const next = yield* configured(cwd, list)
        if (next) return next
        for (const name of ["main", "master"]) {
          if (list.includes(name)) return { name, ref: name } satisfies Base
        }
      })

      const hasHead = Effect.fn("Git.hasHead")(function* (cwd: string) {
        const result = yield* run(["rev-parse", "--verify", "HEAD"], { cwd })
        return result.exitCode === 0
      })

      const mergeBase = Effect.fn("Git.mergeBase")(function* (cwd: string, base: string, head = "HEAD") {
        const result = yield* run(["merge-base", base, head], { cwd })
        if (result.exitCode !== 0) return
        const text = out(result)
        return text || undefined
      })

      const show = Effect.fn("Git.show")(function* (cwd: string, ref: string, file: string, prefix = "") {
        const target = prefix ? `${prefix}${file}` : file
        const result = yield* run(["show", `${ref}:${target}`], { cwd })
        if (result.exitCode !== 0) return ""
        return result.text()
      })

      const status = Effect.fn("Git.status")(function* (cwd: string) {
        return parseStatus(
          yield* text(["status", "--porcelain=v1", "--untracked-files=all", "--no-renames", "-z", "--", "."], { cwd }),
        )
      })

      const diff = Effect.fn("Git.diff")(function* (cwd: string, ref: string) {
        return parseNames(
          yield* text(["diff", "--no-ext-diff", "--no-renames", "--name-status", "-z", ref, "--", "."], { cwd }),
        )
      })

      const stats = Effect.fn("Git.stats")(function* (cwd: string, ref: string) {
        return parseStats(
          yield* text(["diff", "--no-ext-diff", "--no-renames", "--numstat", "-z", ref, "--", "."], { cwd }),
        )
      })

      return Service.of({
        run,
        text,
        lines,
        branch,
        prefix,
        defaultBranch,
        hasHead,
        mergeBase,
        show,
        status,
        diff,
        stats,
      })
    }),
  )

  const platformLayer = NodeChildProcessSpawner.layer.pipe(
    Layer.provideMerge(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)),
  )

  export const defaultLayer = layer.pipe(Layer.provide(platformLayer))
}
