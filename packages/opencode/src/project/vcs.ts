import { Effect, Layer, ServiceMap, Stream } from "effect"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { InstanceState } from "@/effect/instance-state"
import { makeRuntime } from "@/effect/run-service"
import { FileWatcher } from "@/file/watcher"
import { Log } from "@/util/log"
import { git } from "@/util/git"
import { Instance } from "./instance"
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

  export const layer: Layer.Layer<Service, never, Bus.Service> = Layer.effect(
    Service,
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const state = yield* InstanceState.make<State>(
        Effect.fn("Vcs.state")((ctx) =>
          Effect.gen(function* () {
            if (ctx.project.vcs !== "git") {
              return { current: undefined }
            }

            const get = async () => {
              const result = await git(["rev-parse", "--abbrev-ref", "HEAD"], {
                cwd: ctx.worktree,
              })
              if (result.exitCode !== 0) return undefined
              const text = result.text().trim()
              return text || undefined
            }

            const value = {
              current: yield* Effect.promise(() => get()),
            }
            log.info("initialized", { branch: value.current })

            yield* bus.subscribe(FileWatcher.Event.Updated).pipe(
              Stream.filter((evt) => evt.properties.file.endsWith("HEAD")),
              Stream.runForEach(() =>
                Effect.gen(function* () {
                  const next = yield* Effect.promise(() => get())
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

  export const defaultLayer = layer.pipe(Layer.provide(Bus.layer))

  const { runPromise } = makeRuntime(Service, defaultLayer)

  export function init() {
    return runPromise((svc) => svc.init())
  }

  export function branch() {
    return runPromise((svc) => svc.branch())
  }
}
