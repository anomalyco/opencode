/**
 * Effect Service: monitor.
 *
 * Wraps the long-lived bus subscription that drives the real-time
 * dashboard. Lives in `InstanceState` so each open project gets exactly
 * one subscription and is torn down on directory disposal.
 *
 * Per `packages/opencode/AGENTS.md`:
 *   - `init()` is synchronous internally — the caller controls concurrency
 *     via `Effect.forkDetach` from bootstrap.
 *   - The bus subscription is `forkScoped` so it dies with the instance.
 *   - No fibers, no `started` flag — `InstanceState`'s ScopedCache gives us
 *     run-once semantics.
 *   - Module is multi-sibling — there is no `index.ts` barrel here; consumers
 *     import the specific sibling (`@/monitor/service`, `@/monitor/kanban`,
 *     …). See `AGENTS.md` "Multi-sibling directories".
 */

import { Context, Effect, Layer } from "effect"
import { Bus } from "@/bus"
import { InstanceState } from "@/effect"
import { Log } from "@/util"
import { Instance } from "@/project/instance"

const log = Log.create({ service: "monitor" })

export interface Interface {
  readonly init: () => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Monitor") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const state = yield* InstanceState.make<void, never, never>(
      Effect.fn("Monitor.state")(function* () {
        log.info("init", { directory: Instance.directory })

        // Long-lived bus subscription. `forkScoped` so the fiber is
        // interrupted when the Instance is disposed (project closed,
        // worktree swapped, …). The actual event dispatch is split out
        // into the `kanban` / `health` / `alerts` / `webhook` modules;
        // this service just owns the subscription.
        yield* Effect.forkScoped(
          Effect.gen(function* () {
            const unsub = Bus.subscribeAll((event) => {
              log.debug("event", { type: event.type })
            })
            yield* Effect.addFinalizer(() => Effect.sync(unsub))
          }),
        )
      }),
    )

    return Service.of({
      init: Effect.fn("Monitor.init")(function* () {
        yield* InstanceState.get(state)
      }),
    })
  }),
)

/**
 * Convenience namespace projection so callers can write
 * `Monitor.Service` / `Monitor.layer` / `Monitor.defaultLayer` — matches
 * the pattern other opencode modules use (see `@/file/watcher`,
 * `@/snapshot`). The `index.ts` barrel picks this up via
 * `export * as Monitor from "."`.
 */
export const defaultLayer = layer
