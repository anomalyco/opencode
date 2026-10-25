import fs from "node:fs"
import path from "node:path"
import { Effect, Option, Schema, Stream } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import { Global } from "@bolt-ai/core/global"
import { Shell } from "@bolt-ai/core/shell"
import { Config } from "@/config/config"
import { InstanceState } from "@/effect/instance-state"
import { BashArity } from "@/permission/arity"
import { ShellID } from "./shell/id"
import DESCRIPTION from "./profile.txt"
import * as Tool from "./tool"

const DEFAULT_DURATION = 30_000
const DEFAULT_LIMIT = 10

export const Profile = Schema.Struct({
  nodes: Schema.Array(
    Schema.Struct({
      id: Schema.Number,
      callFrame: Schema.Struct({
        functionName: Schema.String,
        url: Schema.String,
        lineNumber: Schema.Number,
      }),
      children: Schema.optional(Schema.Array(Schema.Number)),
    }),
  ),
  samples: Schema.optional(Schema.Array(Schema.Number)),
  timeDeltas: Schema.optional(Schema.Array(Schema.Number)),
})

export type Frame = {
  name: string
  location: string
  self: number
  total: number
}

// V8 bookkeeping frames that carry no user code.
const meta = new Set(["(root)", "(program)", "(idle)", "(garbage collector)"])

/**
 * Aggregate a V8 .cpuprofile into hot frames sorted by self time.
 * Times are in microseconds. Nodes sharing a function/location are merged;
 * for recursive functions the merged total can exceed wall time.
 */
export function aggregate(profile: Schema.Schema.Type<typeof Profile>, limit: number): Frame[] {
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]))
  const samples = profile.samples ?? []
  const deltas = profile.timeDeltas ?? []
  const self = new Map<number, number>()
  samples.forEach((id, index) => {
    self.set(id, (self.get(id) ?? 0) + Math.max(0, deltas[index] ?? 0))
  })
  const totals = new Map<number, number>()
  const total = (id: number): number => {
    const cached = totals.get(id)
    if (cached !== undefined) return cached
    const node = nodes.get(id)
    if (!node) return 0
    // The node graph is a tree, so seeding the memo before recursing is enough to stay safe.
    totals.set(id, self.get(id) ?? 0)
    const sum = (node.children ?? []).reduce((acc, child) => acc + total(child), self.get(id) ?? 0)
    totals.set(id, sum)
    return sum
  }
  const merged = new Map<string, Frame>()
  for (const node of profile.nodes) {
    if (meta.has(node.callFrame.functionName)) continue
    const name = node.callFrame.functionName || "(anonymous)"
    const location = node.callFrame.url ? `${node.callFrame.url}:${node.callFrame.lineNumber + 1}` : "(native)"
    const key = `${name}\u0000${location}`
    const existing = merged.get(key) ?? { name, location, self: 0, total: 0 }
    existing.self += self.get(node.id) ?? 0
    existing.total += total(node.id)
    merged.set(key, existing)
  }
  return [...merged.values()]
    .filter((frame) => frame.self > 0 || frame.total > 0)
    .sort((a, b) => b.self - a.self || b.total - a.total)
    .slice(0, limit)
}

/**
 * Decide how to profile a command: Bun and Node get the built-in V8 CPU
 * profiler writing into `dir`, everything else falls back to /usr/bin/time.
 */
export function plan(command: string, dir: string) {
  const tokens = command.trim().split(/\s+/)
  const runtime = path.basename(tokens[0] ?? "").replace(/\.exe$/, "")
  if (runtime === "bun" || runtime === "node") {
    return {
      kind: "cpuprofile" as const,
      command: [tokens[0], "--cpu-prof", `--cpu-prof-dir=${dir}`, ...tokens.slice(1)].join(" "),
    }
  }
  return { kind: "time" as const, command: `/usr/bin/time -v ${command}` }
}

/** Render hot frames as an aligned table. Times converted to milliseconds. */
export function render(frames: Frame[]) {
  const ms = (micros: number) => (micros / 1000).toFixed(1)
  const rows = frames.map((frame) => [ms(frame.self), ms(frame.total), frame.name, frame.location])
  const header = ["self(ms)", "total(ms)", "function", "location"]
  const widths = [header, ...rows].reduce(
    (acc, row) => acc.map((width, index) => Math.max(width, row[index].length)),
    [0, 0, 0, 0],
  )
  const line = (row: string[]) =>
    [row[0].padStart(widths[0]), row[1].padStart(widths[1]), row[2].padEnd(widths[2]), row[3]].join("  ")
  return [line(header), ...rows.map(line)].join("\n")
}

const decode = Schema.decodeUnknownOption(Schema.fromJsonString(Profile))

export const Parameters = Schema.Struct({
  command: Schema.String.annotate({
    description: "The command to profile, e.g. `bun ./scripts/bench.ts`. Must exit on its own to produce a profile.",
  }),
  duration: Schema.optional(Schema.Number).annotate({
    description: "Maximum run time in milliseconds before the command is killed (default 30000)",
  }),
  limit: Schema.optional(Schema.Number).annotate({
    description: "Number of hot frames to return (default 10)",
  }),
})

export const ProfileTool = Tool.define(
  "profile",
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner
    const config = yield* Config.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const tokens = params.command.trim().split(/\s+/)
          yield* ctx.ask({
            permission: ShellID.ToolID,
            patterns: [params.command],
            always: [BashArity.prefix(tokens).join(" ") + " *"],
            metadata: { command: params.command, profile: true },
          })

          const dir = path.join(Global.Path.tmp, `profile-${Date.now().toString(36)}`)
          fs.mkdirSync(dir, { recursive: true })
          const planned = plan(params.command, dir)
          // Without /usr/bin/time the fallback degrades to a plain run with wall time only.
          const timed = planned.kind === "time" && fs.existsSync("/usr/bin/time")
          const command = planned.kind === "cpuprofile" || timed ? planned.command : params.command

          const cfg = yield* config.get()
          const shell = Shell.acceptable(cfg.shell)
          const duration = params.duration ?? DEFAULT_DURATION
          const started = Date.now()

          let raw = ""
          let expired = false
          const code = yield* Effect.scoped(
            Effect.gen(function* () {
              const handle = yield* spawner.spawn(
                ChildProcess.make(command, [], {
                  shell,
                  cwd: instance.directory,
                  stdin: "ignore",
                  detached: process.platform !== "win32",
                }),
              )
              yield* Effect.forkScoped(
                Stream.runForEach(Stream.decodeText(handle.all), (chunk) =>
                  Effect.sync(() => {
                    raw += chunk
                    if (raw.length > 200_000) raw = raw.slice(raw.length - 200_000)
                  }),
                ),
              )
              const exit = yield* Effect.raceAll([
                handle.exitCode.pipe(Effect.map((code) => ({ kind: "exit" as const, code }))),
                Effect.sleep(`${duration} millis`).pipe(Effect.map(() => ({ kind: "timeout" as const, code: null }))),
              ])
              if (exit.kind === "timeout") {
                expired = true
                yield* handle.kill({ forceKillAfter: "3 seconds" }).pipe(Effect.catch(() => Effect.void))
              }
              return exit.code
            }),
          ).pipe(Effect.orDie)

          const elapsed = Date.now() - started
          const lines: string[] = []
          lines.push(`command=${params.command}`)
          lines.push(`mode=${planned.kind === "cpuprofile" ? "cpu-profile" : timed ? "time" : "plain"}`)
          if (code !== null) lines.push(`exit=${code}`)
          lines.push(`elapsed=${elapsed}ms`)
          if (expired) lines.push(`killed after ${duration}ms duration cap`)

          if (planned.kind === "time") {
            lines.push("")
            lines.push(
              timed
                ? "Non-JS command: no CPU profile available, /usr/bin/time -v resource summary below."
                : "Non-JS command and /usr/bin/time is not installed: plain run, wall time only.",
            )
            lines.push("", raw.trimEnd() || "(no output)")
            return {
              title: `profile ${params.command} [${planned.kind}]`,
              output: lines.join("\n"),
              metadata: { command: params.command, mode: "time", exit: code, frames: 0 },
            }
          }

          const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((file) => file.endsWith(".cpuprofile")) : []
          if (files.length === 0) {
            lines.push("")
            lines.push(
              expired
                ? "No .cpuprofile was written: the process was killed at the duration cap before it could exit cleanly. Profile a bounded workload instead."
                : "No .cpuprofile was written by the runtime.",
            )
            lines.push("", "Output tail:", raw.trimEnd() || "(no output)")
            return {
              title: `profile ${params.command} [no profile]`,
              output: lines.join("\n"),
              metadata: { command: params.command, mode: "cpu-profile", exit: code, frames: 0 },
            }
          }

          const text = yield* Effect.promise(() => Bun.file(path.join(dir, files[0])).text())
          const parsed = decode(text)
          if (Option.isNone(parsed)) {
            lines.push("", `Could not parse ${files[0]} as a V8 CPU profile.`)
            return {
              title: `profile ${params.command} [parse error]`,
              output: lines.join("\n"),
              metadata: { command: params.command, mode: "cpu-profile", exit: code, frames: 0 },
            }
          }

          const frames = aggregate(parsed.value, params.limit ?? DEFAULT_LIMIT)
          lines.push("", `Top ${frames.length} hot frames by self time:`, "", render(frames))
          return {
            title: `profile ${params.command} [${frames.length} frames]`,
            output: lines.join("\n"),
            metadata: { command: params.command, mode: "cpu-profile", exit: code, frames: frames.length },
          }
        }),
    }
  }),
)
