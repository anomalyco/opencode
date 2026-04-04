import { Effect, Layer, Schedule, ServiceMap, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import z from "zod"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import * as CrossSpawnSpawner from "@/effect/cross-spawn-spawner"
import { InstanceState } from "@/effect/instance-state"
import { makeRuntime } from "@/effect/run-service"
import { FileWatcher } from "@/file/watcher"
import { Log } from "@/util/log"

export namespace Vcs {
  const log = Log.create({ service: "vcs" })

  const StatusSchema = z.object({
    dirty: z.boolean().optional(),
    staged: z.number().optional(),
    unstaged: z.number().optional(),
    untracked: z.number().optional(),
    conflicted: z.number().optional(),
  })

  export const Event = {
    BranchUpdated: BusEvent.define(
      "vcs.branch.updated",
      z
        .object({
          branch: z.string().optional(),
        })
        .merge(StatusSchema),
    ),
  }

  export const Info = z
    .object({
      branch: z.string().optional(),
    })
    .merge(StatusSchema)
    .meta({
      ref: "VcsInfo",
    })
  export type Info = z.infer<typeof Info>

  export interface Interface {
    readonly init: () => Effect.Effect<void>
    readonly branch: () => Effect.Effect<string | undefined>
    readonly status: () => Effect.Effect<StatusData>
  }

  interface StatusData {
    dirty: boolean
    staged: number
    unstaged: number
    untracked: number
    conflicted: number
  }

  interface State {
    current: string | undefined
    status: StatusData
  }

  const EMPTY_STATUS: StatusData = { dirty: false, staged: 0, unstaged: 0, untracked: 0, conflicted: 0 }

  function statusEqual(a: StatusData, b: StatusData): boolean {
    return (
      a.dirty === b.dirty &&
      a.staged === b.staged &&
      a.unstaged === b.unstaged &&
      a.untracked === b.untracked &&
      a.conflicted === b.conflicted
    )
  }

  function parseStatus(porcelain: string): StatusData {
    let staged = 0
    let unstaged = 0
    let untracked = 0
    let conflicted = 0

    for (const line of porcelain.split("\n")) {
      if (line.length < 2) continue
      const x = line[0]
      const y = line[1]

      if (x === "U" || y === "U" || (x === "A" && y === "A") || (x === "D" && y === "D")) {
        conflicted++
      } else if (x === "?" && y === "?") {
        untracked++
      } else {
        if (x !== " " && x !== "?") staged++
        if (y !== " " && y !== "?") unstaged++
      }
    }

    return {
      dirty: staged + unstaged + untracked + conflicted > 0,
      staged,
      unstaged,
      untracked,
      conflicted,
    }
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@xcsh/Vcs") {}

  export const layer: Layer.Layer<Service, never, Bus.Service | ChildProcessSpawner.ChildProcessSpawner> = Layer.effect(
    Service,
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner

      const git = Effect.fnUntraced(
        function* (args: string[], opts: { cwd: string }) {
          const handle = yield* spawner.spawn(
            ChildProcess.make("git", args, { cwd: opts.cwd, extendEnv: true, stdin: "ignore" }),
          )
          const text = yield* Stream.mkString(Stream.decodeText(handle.stdout))
          const code = yield* handle.exitCode
          return { code, text }
        },
        Effect.scoped,
        Effect.catch(() => Effect.succeed({ code: ChildProcessSpawner.ExitCode(1), text: "" })),
      )

      const state = yield* InstanceState.make<State>(
        Effect.fn("Vcs.state")((ctx) =>
          Effect.gen(function* () {
            if (ctx.project.vcs !== "git") {
              return { current: undefined, status: EMPTY_STATUS }
            }

            const getBranch = Effect.fnUntraced(function* () {
              const result = yield* git(["rev-parse", "--abbrev-ref", "HEAD"], { cwd: ctx.worktree })
              if (result.code !== 0) return undefined
              const text = result.text.trim()
              return text || undefined
            })

            const getStatus = Effect.fnUntraced(function* () {
              const result = yield* git(["status", "--porcelain"], { cwd: ctx.worktree })
              if (result.code !== 0) return EMPTY_STATUS
              return parseStatus(result.text)
            })

            function publishUpdate(branch: string | undefined, s: StatusData) {
              return bus.publish(Event.BranchUpdated, { branch, ...s })
            }

            const value: State = {
              current: yield* getBranch(),
              status: yield* getStatus(),
            }
            log.info("initialized", { branch: value.current, ...value.status })

            // React to HEAD changes (branch switches)
            yield* bus.subscribe(FileWatcher.Event.Updated).pipe(
              Stream.filter((evt) => evt.properties.file.endsWith("HEAD")),
              Stream.runForEach(() =>
                Effect.gen(function* () {
                  const nextBranch = yield* getBranch()
                  const nextStatus = yield* getStatus()
                  if (nextBranch !== value.current || !statusEqual(nextStatus, value.status)) {
                    log.info("branch changed", { from: value.current, to: nextBranch, ...nextStatus })
                    value.current = nextBranch
                    value.status = nextStatus
                    yield* publishUpdate(nextBranch, nextStatus)
                  }
                }),
              ),
              Effect.forkScoped,
            )

            // React to .git/index changes (staging area modifications)
            yield* bus.subscribe(FileWatcher.Event.Updated).pipe(
              Stream.filter((evt) => evt.properties.file.endsWith("index")),
              Stream.runForEach(() =>
                Effect.gen(function* () {
                  const nextStatus = yield* getStatus()
                  if (!statusEqual(nextStatus, value.status)) {
                    log.info("status changed", nextStatus)
                    value.status = nextStatus
                    yield* publishUpdate(value.current, nextStatus)
                  }
                }),
              ),
              Effect.forkScoped,
            )

            // Periodic poll every 10 seconds to catch unstaged worktree edits
            yield* Effect.gen(function* () {
              const nextStatus = yield* getStatus()
              if (!statusEqual(nextStatus, value.status)) {
                log.info("status changed (poll)", nextStatus)
                value.status = nextStatus
                yield* publishUpdate(value.current, nextStatus)
              }
            }).pipe(Effect.repeat(Schedule.spaced("10 seconds")), Effect.forkScoped)

            return value
          }),
        ),
      )

      return Service.of({
        init: Effect.fn("Vcs.init")(function* () {
          yield* InstanceState.get(state)
        }),
        branch: Effect.fn("Vcs.branch")(function* () {
          return yield* InstanceState.use(state, (x) => x.current)
        }),
        status: Effect.fn("Vcs.status")(function* () {
          return yield* InstanceState.use(state, (x) => x.status)
        }),
      })
    }),
  )

  export const defaultLayer = layer.pipe(Layer.provide(Bus.layer), Layer.provide(CrossSpawnSpawner.defaultLayer))

  const { runPromise } = makeRuntime(Service, defaultLayer)

  export function init() {
    return runPromise((svc) => svc.init())
  }

  export function branch() {
    return runPromise((svc) => svc.branch())
  }

  export function status() {
    return runPromise((svc) => svc.status())
  }
}
