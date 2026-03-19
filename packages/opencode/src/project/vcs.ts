import { Effect, Layer, ServiceMap } from "effect"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { InstanceContext } from "@/effect/instance-context"
import { FileWatcher } from "@/file/watcher"
import { Log } from "@/util/log"
import { git } from "@/util/git"
import { Instance } from "./instance"
import { pull } from "./pull-request"
import z from "zod"

export namespace Vcs {
  const log = Log.create({ service: "vcs" })

  export const Event = {
    BranchUpdated: BusEvent.define(
      "vcs.branch.updated",
      z.object({
        branch: z.string().optional(),
        pull_request_url: z.string().optional(),
      }),
    ),
  }

  export const Info = z
    .object({
      branch: z.string().optional(),
      pull_request_url: z.string().optional(),
    })
    .meta({
      ref: "VcsInfo",
    })
  export type Info = z.infer<typeof Info>

  export interface Interface {
    readonly get: () => Effect.Effect<Info>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/Vcs") {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const instance = yield* InstanceContext
      let info: Info = {}

      if (instance.project.vcs === "git") {
        const getInfo = async () => {
          const result = await git(["rev-parse", "--abbrev-ref", "HEAD"], {
            cwd: instance.project.worktree,
          })
          const branch = result.exitCode === 0 ? result.text().trim() || undefined : undefined
          return {
            branch,
            pull_request_url: await pull(instance.project.worktree, branch),
          }
        }

        info = yield* Effect.promise(() => getInfo())
        log.info("initialized", info)

        yield* Effect.acquireRelease(
          Effect.sync(() =>
            Bus.subscribe(
              FileWatcher.Event.Updated,
              Instance.bind(async (evt) => {
                if (!evt.properties.file.endsWith("HEAD")) return
                const next = await getInfo()
                if (next.branch !== info.branch || next.pull_request_url !== info.pull_request_url) {
                  log.info("updated", { from: info, to: next })
                  info = next
                  Bus.publish(Event.BranchUpdated, next)
                }
              }),
            ),
          ),
          (unsubscribe) => Effect.sync(unsubscribe),
        )
      }

      return Service.of({
        get: Effect.fn("Vcs.get")(function* () {
          return info
        }),
      })
    }),
  )
}
