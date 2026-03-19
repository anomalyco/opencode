import { Effect, Layer, ServiceMap } from "effect"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { InstanceContext } from "@/effect/instance-context"
import { FileWatcher } from "@/file/watcher"
import { Snapshot } from "@/snapshot"
import { Filesystem } from "@/util/filesystem"
import { Log } from "@/util/log"
import { git } from "@/util/git"
import path from "path"
import { Instance } from "./instance"
import z from "zod"

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

type Base = { name: string; ref: string }
type Item = { file: string; code: string; status: Snapshot.FileDiff["status"] }

async function mapLimit<T, R>(list: T[], limit: number, fn: (item: T) => Promise<R>) {
  const size = Math.max(1, limit)
  const out: R[] = new Array(list.length)
  let idx = 0
  await Promise.all(
    Array.from({ length: Math.min(size, list.length) }, async () => {
      while (true) {
        const i = idx
        idx += 1
        if (i >= list.length) return
        out[i] = await fn(list[i]!)
      }
    }),
  )
  return out
}

function out(result: { text(): string }) {
  return result.text().trim()
}

async function run(cwd: string, args: string[]) {
  return git([...cfg, ...args], { cwd })
}

async function branch(cwd: string) {
  const result = await run(cwd, ["rev-parse", "--abbrev-ref", "HEAD"])
  if (result.exitCode !== 0) return
  const text = out(result)
  return text || undefined
}

async function prefix(cwd: string) {
  const result = await run(cwd, ["rev-parse", "--show-prefix"])
  if (result.exitCode !== 0) return ""
  return out(result)
}

async function branches(cwd: string) {
  const result = await run(cwd, ["for-each-ref", "--format=%(refname:short)", "refs/heads"])
  if (result.exitCode !== 0) return []
  return out(result)
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean)
}

async function configured(cwd: string, list: string[]) {
  const result = await run(cwd, ["config", "init.defaultBranch"])
  if (result.exitCode !== 0) return
  const name = out(result)
  if (!name || !list.includes(name)) return
  const ref = await run(cwd, ["rev-parse", "--verify", name])
  if (ref.exitCode !== 0) return
  return { name, ref: name } satisfies Base
}

async function remoteHead(cwd: string, remote: string) {
  const result = await run(cwd, ["ls-remote", "--symref", remote, "HEAD"])
  if (result.exitCode !== 0) return
  for (const line of result.text().split("\n")) {
    const match = /^ref: refs\/heads\/(.+)\tHEAD$/.exec(line.trim())
    if (!match?.[1]) continue
    return { name: match[1], ref: `${remote}/${match[1]}` } satisfies Base
  }
}

async function primary(cwd: string) {
  const result = await run(cwd, ["remote"])
  const list =
    result.exitCode !== 0
      ? []
      : out(result)
          .split("\n")
          .map((item) => item.trim())
          .filter(Boolean)
  if (list.includes("origin")) return "origin"
  if (list.length === 1) return list[0]
  if (list.includes("upstream")) return "upstream"
  return list[0]
}

async function base(cwd: string) {
  const remote = await primary(cwd)
  if (remote) {
    const head = await run(cwd, ["symbolic-ref", `refs/remotes/${remote}/HEAD`])
    if (head.exitCode === 0) {
      const ref = out(head).replace(/^refs\/remotes\//, "")
      const name = ref.startsWith(`${remote}/`) ? ref.slice(`${remote}/`.length) : ""
      if (name) return { name, ref } satisfies Base
    }

    const next = await remoteHead(cwd, remote)
    if (next) return next
  }

  const list = await branches(cwd)
  const next = await configured(cwd, list)
  if (next) return next
  for (const name of ["main", "master"]) {
    if (list.includes(name)) return { name, ref: name }
  }
}

async function head(cwd: string) {
  const result = await run(cwd, ["rev-parse", "--verify", "HEAD"])
  return result.exitCode === 0
}

async function work(cwd: string, file: string) {
  const full = path.join(cwd, file)
  if (!(await Filesystem.exists(full))) return ""
  const buf = await Filesystem.readBytes(full).catch(() => Buffer.alloc(0))
  if (buf.includes(0)) return ""
  return buf.toString("utf8")
}

async function show(cwd: string, ref: string | undefined, file: string, base: string) {
  if (!ref) return ""
  const target = base ? `${base}${file}` : file
  const result = await run(cwd, ["show", `${ref}:${target}`])
  if (result.exitCode !== 0) return ""
  return result.text()
}

function kind(code: string | undefined): "added" | "deleted" | "modified" {
  if (code === "??") return "added"
  if (code?.includes("U")) return "modified"
  if (code?.includes("A") && !code.includes("D")) return "added"
  if (code?.includes("D") && !code.includes("A")) return "deleted"
  return "modified"
}

function count(text: string) {
  if (!text) return 0
  if (!text.endsWith("\n")) return text.split("\n").length
  return text.slice(0, -1).split("\n").length
}

function split(text: string) {
  return text.split("\0").filter(Boolean)
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

function parseNums(text: string) {
  const out = new Map<string, { additions: number; deletions: number }>()
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
    out.set(file, {
      additions: Number.isFinite(additions) ? additions : 0,
      deletions: Number.isFinite(deletions) ? deletions : 0,
    })
  }
  return out
}

function merge(...lists: Item[][]) {
  const out = new Map<string, Item>()
  for (const list of lists) {
    for (const item of list) {
      if (!out.has(item.file)) out.set(item.file, item)
    }
  }
  return [...out.values()]
}

async function files(cwd: string, ref: string | undefined, list: Item[], nums: Map<string, { additions: number; deletions: number }>) {
  const base = ref ? await prefix(cwd) : ""
  const next = await mapLimit(list, 8, async (item) => {
    const before = item.status === "added" ? "" : await show(cwd, ref, item.file, base)
    const after = item.status === "deleted" ? "" : await work(cwd, item.file)
    const stat = nums.get(item.file)
    return {
      file: item.file,
      before,
      after,
      additions: stat?.additions ?? (item.status === "added" ? count(after) : 0),
      deletions: stat?.deletions ?? (item.status === "deleted" ? count(before) : 0),
      status: item.status,
    } satisfies Snapshot.FileDiff
  })
  return next.toSorted((a, b) => a.file.localeCompare(b.file))
}

async function status(cwd: string) {
  const result = await run(cwd, ["status", "--porcelain=v1", "--untracked-files=all", "--no-renames", "-z", "--", "."])
  return parseStatus(result.text())
}

async function stats(cwd: string, ref: string) {
  const result = await run(cwd, ["diff", "--no-ext-diff", "--no-renames", "--numstat", "-z", ref, "--", "."])
  return parseNums(result.text())
}

async function diff(cwd: string, ref: string) {
  const result = await run(cwd, ["diff", "--no-ext-diff", "--no-renames", "--name-status", "-z", ref, "--", "."])
  return parseNames(result.text())
}

async function track(cwd: string, ref: string | undefined) {
  const [list, nums] = ref ? await Promise.all([status(cwd), stats(cwd, ref)]) : [await status(cwd), new Map()]
  return files(cwd, ref, list, nums)
}

async function compare(cwd: string, ref: string) {
  const [list, nums, extra] = await Promise.all([diff(cwd, ref), stats(cwd, ref), status(cwd)])
  return files(
    cwd,
    ref,
    merge(
      list,
      extra.filter((item) => item.code === "??"),
    ),
    nums,
  )
}

export namespace Vcs {
  const log = Log.create({ service: "vcs" })

  export const Mode = z.enum(["git", "branch"])
  export type Mode = z.infer<typeof Mode>

  export const Event = {
    BranchUpdated: BusEvent.define(
      "vcs.branch.updated",
      z.object({
        branch: z.string().optional(),
      }),
    ),
  }

  export const Info = z
    .object({
      branch: z.string().optional(),
      default_branch: z.string().optional(),
    })
    .meta({
      ref: "VcsInfo",
    })
  export type Info = z.infer<typeof Info>

  export interface Interface {
    readonly branch: () => Effect.Effect<string | undefined>
    readonly defaultBranch: () => Effect.Effect<string | undefined>
    readonly diff: (mode: Mode) => Effect.Effect<Snapshot.FileDiff[]>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/Vcs") {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const instance = yield* InstanceContext
      let current: string | undefined
      let root: Base | undefined

      if (instance.project.vcs === "git") {
        const get = () => branch(instance.directory)

        ;[current, root] = yield* Effect.promise(() => Promise.all([get(), base(instance.directory)]))
        log.info("initialized", { branch: current, default_branch: root?.name })

        yield* Effect.acquireRelease(
          Effect.sync(() =>
            Bus.subscribe(
              FileWatcher.Event.Updated,
              Instance.bind(async (evt) => {
                if (!evt.properties.file.endsWith("HEAD")) return
                const next = await get()
                if (next === current) return
                log.info("branch changed", { from: current, to: next })
                current = next
                Bus.publish(Event.BranchUpdated, { branch: next })
              }),
            ),
          ),
          (unsubscribe) => Effect.sync(unsubscribe),
        )
      }

      return Service.of({
        branch: Effect.fn("Vcs.branch")(function* () {
          return current
        }),
        defaultBranch: Effect.fn("Vcs.defaultBranch")(function* () {
          return root?.name
        }),
        diff: Effect.fn("Vcs.diff")(function* (mode: Mode) {
          if (instance.project.vcs !== "git") return []
          if (mode === "git") {
            const ok = yield* Effect.promise(() => head(instance.directory))
            return yield* Effect.promise(() => track(instance.directory, ok ? "HEAD" : undefined))
          }

          if (!root) return []
          if (current && current === root.name) return []
          const ref = yield* Effect.promise(() => run(instance.directory, ["merge-base", root.ref, "HEAD"]))
          if (ref.exitCode !== 0) return []
          const text = out(ref)
          if (!text) return []
          return yield* Effect.promise(() => compare(instance.directory, text))
        }),
      })
    }),
  )
}
