import { Effect, Ref, HashSet, Context, Layer } from "effect"
import { Bus } from "@/bus"
import { Issue } from "./issue"
import { InstanceState } from "@/effect/instance-state"

type State = {
  ref: Ref.Ref<HashSet.HashSet<string>>
}

export const advance = Effect.fn("Issue.AutoProgress.advance")(function* (
  issue: Issue.Interface,
  bus: Bus.Interface,
  directory: string,
) {
  // Run both rules in sequence. Rule 1 may fire (mark current L1 done), and
  // then Rule 2 promotes the next pending L1 in the same tick. This handles
  // the cascade: both kids done → a → done, b → in_progress in one call.
  const all = yield* issue.get({ directory })

  // Rule 1: L1 in_progress → check if all children are done/canceled
  const head = all.find((i) => i.level === 0 && i.status === "in_progress")
  if (head) {
    const kids = all.filter((i) => i.level === 1 && i.parent_id === head.id)
    if (kids.length > 0 && kids.every((k) => k.status === "done" || k.status === "canceled")) {
      yield* issue.patchStatus({ directory, id: head.id, status: "done" })
      yield* bus.publish(Issue.Event.Progressed, {
        directory,
        id: head.id,
        from: "in_progress",
        to: "done",
        reason: "auto",
      })
    }
  }

  // Rule 2: promote the first pending L1 to in_progress (if any).
  // Reload after Rule 1 may have changed state.
  const after = yield* issue.get({ directory })
  const next = after.find((i) => i.level === 0 && i.status === "todo")
  if (!next) return

  yield* issue.patchStatus({ directory, id: next.id, status: "in_progress" })
  yield* bus.publish(Issue.Event.Progressed, {
    directory,
    id: next.id,
    from: "todo",
    to: "in_progress",
    reason: "auto",
  })

  // Promote all pending L2 children to in_progress in parallel
  const kids = after.filter((i) => i.level === 1 && i.parent_id === next.id && i.status === "todo")
  if (kids.length > 0) {
    yield* Effect.all(
      kids.map((k) =>
        Effect.gen(function* () {
          yield* issue.patchStatus({ directory, id: k.id, status: "in_progress" })
          yield* bus.publish(Issue.Event.Progressed, {
            directory,
            id: k.id,
            from: "todo",
            to: "in_progress",
            reason: "auto",
          })
        }),
      ),
      { concurrency: "unbounded" },
    )
  }
})

export namespace AutoProgress {
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
      const bus = yield* Bus.Service
      const issue = yield* Issue.Service

      const state = yield* InstanceState.make<State>(
        Effect.fn("Issue.AutoProgress.state")(function* (_ctx) {
          return { ref: yield* Ref.make(HashSet.empty<string>()) }
        }),
      )

      const tick = Effect.fn("Issue.AutoProgress.tick")(function* (directory: string) {
        const s = yield* InstanceState.get(state)
        const set = yield* Ref.get(s.ref)
        if (!HashSet.has(set, directory)) return
        yield* advance(issue, bus, directory)
      })

      const start = Effect.fn("Issue.AutoProgress.start")(function* (directory: string) {
        const s = yield* InstanceState.get(state)
        const existed = yield* Ref.modify(s.ref, (set) => {
          if (HashSet.has(set, directory)) return [true, set]
          return [false, HashSet.add(set, directory)]
        })
        if (!existed) yield* advance(issue, bus, directory)
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

      return Service.of({ start, stop, tick, status, isActive })
    }),
  )

  // We provide both Bus.defaultLayer and Issue.defaultLayer in the chain so
  // the resulting layer has no input requirements (it's a self-contained
  // default). Both Issue and AutoProgress use the same module-level Bus
  // instance through Effect's layer dedup, so all consumers share one bus.
  export const defaultLayer = layer.pipe(Layer.provide(Issue.defaultLayer), Layer.provide(Bus.defaultLayer))
}
