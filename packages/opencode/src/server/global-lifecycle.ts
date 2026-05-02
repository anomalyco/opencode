import { GlobalBus } from "@/bus/global"
import { InstanceStore } from "@/project/instance-store"
import { Effect } from "effect"
import { Event } from "./event"

export const emitGlobalDisposed = Effect.sync(() =>
  GlobalBus.emit("event", {
    directory: "global",
    payload: {
      type: Event.Disposed.type,
      properties: {},
    },
  }),
)

export const disposeAllInstancesAndEmitGlobalDisposed = Effect.fn(
  "Server.disposeAllInstancesAndEmitGlobalDisposed",
)(function* (options?: { swallowErrors?: boolean }) {
  const store = yield* InstanceStore.Service
  const dispose = store.disposeAll()
  yield* (options?.swallowErrors ? dispose.pipe(Effect.catch(() => Effect.void)) : dispose)
  yield* emitGlobalDisposed
})

export * as GlobalLifecycle from "./global-lifecycle"
