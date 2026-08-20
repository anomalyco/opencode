import { Effect } from "effect"
import { UpdaterRpcs } from "../../shared/ipc-rpc"
import { IpcPortHandoff } from "../ipc-transport"
import { Updater } from "../updater"
import { sender } from "./context"

export const updaterHandlers = UpdaterRpcs.toLayer(
  Effect.gen(function* () {
    const handoff = yield* IpcPortHandoff
    const updater = yield* Updater.Service
    return UpdaterRpcs.of({
      UpdaterSubscribe: (_args, context) => updater.subscribe(sender(handoff, context)),
      UpdaterUnsubscribe: (_args, context) => updater.unsubscribe(sender(handoff, context).id),
      UpdaterCheck: () => updater.check,
      UpdaterInstall: () => updater.install,
    })
  }),
)
