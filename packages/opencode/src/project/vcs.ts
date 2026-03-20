import { Effect, Layer, ServiceMap } from "effect"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { InstanceContext } from "@/effect/instance-context"
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
      branch: z.string(),
    })
    .meta({
      ref: "VcsInfo",
    })
  export type Info = z.infer<typeof Info>

  export interface Interface {
    readonly branch: () => Effect.Effect<string | undefined>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/Vcs") {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const instance = yield* InstanceContext
      let currentBranch: string | undefined

      if (instance.project.vcs === "git") {
        const getCurrentBranch = async () => {
          const result = await git(["rev-parse", "--abbrev-ref", "HEAD"], {
            cwd: instance.project.worktree,
          })
          if (result.exitCode !== 0) return undefined
          const text = result.text().trim()
          return text || undefined
        }

        currentBranch = yield* Effect.promise(() => getCurrentBranch())
        log.info("initialized", { branch: currentBranch })

        yield* Effect.acquireRelease(
          Effect.sync(() =>
            Bus.subscribe(
              FileWatcher.Event.Updated,
              Instance.bind(async (evt) => {
                if (!evt.properties.file.endsWith("HEAD")) return
                const next = await getCurrentBranch()
                if (next !== currentBranch) {
                  log.info("branch changed", { from: currentBranch, to: next })
                  currentBranch = next
                  Bus.publish(Event.BranchUpdated, { branch: next })
                }
              }),
            ),
          ),
          (unsubscribe) => Effect.sync(unsubscribe),
        )
      }

      return Service.of({
        branch: Effect.fn("Vcs.branch")(function* () {
          return currentBranch
        }),
      })
    }),
  ).pipe(Layer.fresh)
}
