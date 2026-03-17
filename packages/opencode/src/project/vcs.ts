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
 * Version Control System types and events.
 *
 * Defines the VCS information schema and event types for branch changes.
 * Currently supports Git as the primary VCS.
 */
export namespace Vcs {
  /**
   * VCS-related events published on the event bus.
   */
  export const Event = {
    /**
     * Published when the current branch changes.
     * Payload includes the new branch name (undefined if detached).
     */
    BranchUpdated: BusEvent.define(
      "vcs.branch.updated",
      z.object({
        branch: z.string().optional(),
      }),
    ),
  }

  /**
   * Zod schema for VCS information.
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
 * VCS Service interface for dependency injection.
 */
export namespace VcsService {
  /**
   * Service interface for VCS operations.
   */
  export interface Service {
    /**
     * Initialize the VCS service.
     */
    readonly init: () => Effect.Effect<void>

    /**
     * Get the current branch name.
     * @returns The current branch name, or undefined if detached/no branch
     */
    readonly branch: () => Effect.Effect<string | undefined>
  }
}

/**
 * Effect-based service for version control system integration.
 *
 * Provides Git branch detection and monitoring via the file watcher.
 * Automatically publishes BranchUpdated events when the current branch changes.
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
