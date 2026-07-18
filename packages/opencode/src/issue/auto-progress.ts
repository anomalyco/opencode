import { Effect, Ref, HashSet, Context, Layer, Stream } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Issue } from "./issue"
import { InstanceState } from "@/effect/instance-state"
import { EventV2Bridge } from "@/event-v2-bridge"

type State = {
  ref: Ref.Ref<HashSet.HashSet<string>>
}

/**
 * AutoProgress target status names. These are the standard Linear default
 * workflow state names. When AutoProgress promotes an issue, it sets the
 * status to one of these names directly — no separate classification field
 * is needed because the 7 Linear default status names fully encode the
 * state classification.
 */
const STARTED_STATUS = "In Progress"
const COMPLETED_STATUS = "Done"

/**
 * Status groups used by the AutoProgress rules. Each group is a set of
 * Linear default status names that share the same semantic classification
 * for the cascade logic. Teams may customize state names, but
 * AutoProgress matches against the standard Linear defaults — custom names
 * are treated as "unknown" and do not trigger auto-advance.
 */
const ACTIVE_STATUSES = new Set(["In Progress", "In Review"])
const COMPLETED_STATUSES = new Set(["Done"])
const TERMINATED_STATUSES = new Set(["Canceled", "Duplicate"])
const DONE_OR_TERMINATED_STATUSES = new Set([...COMPLETED_STATUSES, ...TERMINATED_STATUSES])

export const advance = Effect.fn("Issue.AutoProgress.advance")(function* (issue: Issue.Interface, directory: string) {
  // Run both rules in sequence. Rule 1 may fire (mark current L1 done), and
  // then Rule 2 promotes the next pending L1 in the same tick. This handles
  // the cascade: both kids done → a → done, b → in_progress in one call.
  const all = yield* issue.get({ directory })

  // Rule 1: L1 in an active state (In Progress / In Review) → check if all
  // children are completed or terminated (Done / Canceled / Duplicate)
  const head = all.find((i) => i.level === 0 && ACTIVE_STATUSES.has(i.status ?? ""))
  if (head) {
    const kids = all.filter((i) => i.level === 1 && i.parent_id === head.id)
    if (kids.length > 0 && kids.every((k) => DONE_OR_TERMINATED_STATUSES.has(k.status ?? ""))) {
      yield* issue.patchStatus({ directory, id: head.id, status: COMPLETED_STATUS })
    }
  }

  // Rule 2: promote the first pending L1 (Todo, not Backlog) to started
  // (if any). Reload after Rule 1 may have changed state.
  const after = yield* issue.get({ directory })
  // Find first L1 whose status is "Todo" (Backlog is the default state that
  // does not trigger AutoProgress — only "Todo" does).
  const next = after.find((i) => i.level === 0 && i.status === "Todo")
  if (!next) return

  yield* issue.patchStatus({ directory, id: next.id, status: STARTED_STATUS })

  // Promote all Todo L2 children to started in parallel
  const kids = after.filter((i) => i.level === 1 && i.parent_id === next.id && i.status === "Todo")
  if (kids.length > 0) {
    yield* Effect.all(
      kids.map((k) => issue.patchStatus({ directory, id: k.id, status: STARTED_STATUS })),
      { concurrency: "unbounded" },
    )
  }
})

export interface Interface {
  readonly start: (directory: string) => Effect.Effect<void>
  readonly stop: (directory: string) => Effect.Effect<void>
  readonly tick: (directory: string) => Effect.Effect<void>
  readonly status: (directory: string) => Effect.Effect<"idle" | "running">
  readonly isActive: (directory: string) => Effect.Effect<boolean>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Issue/AutoProgress") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const issue = yield* Issue.Service
    const events = yield* EventV2Bridge.Service

    const state = yield* InstanceState.make<State>(
      Effect.fn("Issue.AutoProgress.state")(function* (_ctx) {
        return { ref: yield* Ref.make(HashSet.empty<string>()) }
      }),
    )

    const tick = Effect.fn("Issue.AutoProgress.tick")(function* (directory: string) {
      const s = yield* InstanceState.get(state)
      const set = yield* Ref.get(s.ref)
      if (!HashSet.has(set, directory)) return
      yield* advance(issue, directory)
    })

    const start = Effect.fn("Issue.AutoProgress.start")(function* (directory: string) {
      const s = yield* InstanceState.get(state)
      const existed = yield* Ref.modify(s.ref, (set) => {
        if (HashSet.has(set, directory)) return [true, set]
        return [false, HashSet.add(set, directory)]
      })
      if (!existed) yield* advance(issue, directory)
    })

    const stop = Effect.fn("Issue.AutoProgress.stop")(function* (directory: string) {
      const s = yield* InstanceState.get(state)
      yield* Ref.update(s.ref, (set) => HashSet.remove(set, directory))
    })

    const status = Effect.fn("Issue.AutoProgress.status")(function* (directory: string) {
      const s = yield* InstanceState.get(state)
      const set = yield* Ref.get(s.ref)
      return HashSet.has(set, directory) ? ("running" as const) : ("idle" as const)
    })

    const isActive = Effect.fn("Issue.AutoProgress.isActive")(function* (directory: string) {
      const s = yield* InstanceState.get(state)
      const set = yield* Ref.get(s.ref)
      return HashSet.has(set, directory)
    })

    // Subscribe to `Issue.Updated` events so AutoProgress can re-tick
    // whenever an issue is manually updated (direct edit, status change,
    // or a pull that reconciled cloud-side edits into a local row). Per
    // ADR-0001 D3 and ADR-0002 D7: the engine "watches `Issue.Updated`
    // and advances L1 items as their L2 children complete." The
    // subscriber lives in this layer's closure and is torn down with the
    // layer via `Effect.forkScoped` (per `packages/opencode/AGENTS.md`'s
    // "use `Effect.forkScoped` inside the layer's closure" rule for
    // background stream consumers). `tick` no-ops when AutoProgress is
    // not active for the event's directory, so the subscriber is always
    // live but does nothing unless `start(directory)` has been called.
    yield* events.subscribe(Issue.Event.Updated).pipe(
      Stream.runForEach((event) => tick(event.data.directory)),
      Effect.forkScoped,
    )

    return Service.of({ start, stop, tick, status, isActive })
  }),
)

export const node = LayerNode.make({ service: Service, layer: layer, deps: [Issue.node, EventV2Bridge.node] })

export * as AutoProgress from "./auto-progress"
