import { Effect, Layer, ServiceMap, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import * as CrossSpawnSpawner from "@/effect/cross-spawn-spawner"
import { InstanceState } from "@/effect/instance-state"
import { makeRuntime } from "@/effect/run-service"
import { FileWatcher } from "@/file/watcher"
import { Log } from "@/util/log"
import z from "zod"

export namespace Vcs {
  const log = Log.create({ service: "vcs" })

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
    })
    .meta({
      ref: "VcsInfo",
    })
  export type Info = z.infer<typeof Info>

  export interface Interface {
    readonly init: () => Effect.Effect<void>
    readonly branch: () => Effect.Effect<string | undefined>
  }

  interface State {
    current: string | undefined
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/Vcs") {}

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
              return { current: undefined }
            }

            const getBranch = Effect.fnUntraced(function* () {
              const result = yield* git(["rev-parse", "--abbrev-ref", "HEAD"], { cwd: ctx.worktree })
              if (result.code !== 0) return undefined
              const text = result.text.trim()
              return text || undefined
            })

            const value = {
              current: yield* getBranch(),
            }
            log.info("initialized", { branch: value.current })

            yield* bus.subscribe(FileWatcher.Event.Updated).pipe(
              Stream.filter((evt) => evt.properties.file.endsWith("HEAD")),
              Stream.runForEach(() =>
                Effect.gen(function* () {
                  const next = yield* getBranch()
                  if (next !== value.current) {
                    log.info("branch changed", { from: value.current, to: next })
                    value.current = next
                    yield* bus.publish(Event.BranchUpdated, { branch: next })
                  }
                }),
              ),
              Effect.forkScoped,
            )

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
}
