import { Effect } from "effect"
import { UpdaterRpcs } from "../../shared/ipc-rpc"
import type { UpdaterIpc } from "../updater"
import { IpcPortHandoff } from "../ipc-transport"
import { sender } from "./context"

export function updaterHandlers(updater: UpdaterIpc) {
  return UpdaterRpcs.toLayer(
    Effect.gen(function* () {
      const handoff = yield* IpcPortHandoff
      return UpdaterRpcs.of({
        UpdaterSubscribe: (_args, context) => Effect.sync(() => updater.subscribe(sender(handoff, context))),
        UpdaterUnsubscribe: (_args, context) => Effect.sync(() => updater.unsubscribe(sender(handoff, context).id)),
        UpdaterCheck: () => Effect.promise(() => updater.check()),
        UpdaterInstall: () => Effect.promise(() => updater.install()),
      })
    }),
  )
}
