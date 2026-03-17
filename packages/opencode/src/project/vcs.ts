import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import z from "zod"
import { Log } from "@/util/log"
import { Instance } from "./instance"
import { InstanceContext } from "@/effect/instance-context"
import { FileWatcher } from "@/file/watcher"
import { git } from "@/util/git"
import { Effect, Layer, ServiceMap } from "effect"

const log = Log.create({ service: "vcs" })

/**
 * VCS (Version Control System) namespace providing types and event definitions.
 *
 * Defines events for VCS operations and schemas for VCS information such as branch names.
 */
export namespace Vcs {
  /**
   * VCS events published via the event bus.
   */
  export const Event = {
    /**
     * Published when the current branch changes.
     */
    BranchUpdated: BusEvent.define(
      "vcs.branch.updated",
      z.object({
        branch: z.string().optional(),
      }),
    ),
  }

  /**
   * Schema for VCS information.
   */
  export const Info = z
    .object({
      branch: z.string(),
    })
    .meta({
      ref: "VcsInfo",
    })
  export type Info = z.infer<typeof Info>
}

/**
 * VCS service interface definition.
 */
export namespace VcsService {
  /**
   * Service interface for VCS operations.
   */
  export interface Service {
    /** Initializes the VCS service */
    readonly init: () => Effect.Effect<void>
    /** Returns the current branch name */
    readonly branch: () => Effect.Effect<string | undefined>
  }
}

/**
 * VCS service implementation using Effect.
 *
 * Manages Git repository state including the current branch. Watches for
 * changes to the HEAD file and publishes events when the branch changes.
 */
export class VcsService extends ServiceMap.Service<VcsService, VcsService.Service>()("@opencode/Vcs") {
  static readonly layer = Layer.effect(
    VcsService,
    Effect.gen(function* () {
      const instance = yield* InstanceContext
      let current: string | undefined

      if (instance.project.vcs === "git") {
        const currentBranch = async () => {
          const result = await git(["rev-parse", "--abbrev-ref", "HEAD"], {
            cwd: instance.project.worktree,
          })
          if (result.exitCode !== 0) return undefined
          const text = result.text().trim()
          return text || undefined
        }

        current = yield* Effect.promise(() => currentBranch())
        log.info("initialized", { branch: current })

        const unsubscribe = Bus.subscribe(
          FileWatcher.Event.Updated,
          Instance.bind(async (evt) => {
            if (!evt.properties.file.endsWith("HEAD")) return
            const next = await currentBranch()
            if (next !== current) {
              log.info("branch changed", { from: current, to: next })
              current = next
              Bus.publish(Vcs.Event.BranchUpdated, { branch: next })
            }
          }),
        )

        yield* Effect.addFinalizer(() => Effect.sync(unsubscribe))
      }

      return VcsService.of({
        init: Effect.fn("VcsService.init")(function* () {}),
        branch: Effect.fn("VcsService.branch")(function* () {
          return current
        }),
      })
    }),
  )
}
