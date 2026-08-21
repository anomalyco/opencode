import { Effect } from "effect"
import { EventRpcs } from "../../shared/ipc-rpc"
import { ipcEventStream } from "../ipc-events"
import { IpcPortHandoff } from "../ipc-transport"
import { sender } from "./context"

export const eventHandlers = EventRpcs.toLayer(
  Effect.gen(function* () {
    const handoff = yield* IpcPortHandoff
    return EventRpcs.of({
      DesktopEvents: (_request, context) => ipcEventStream(sender(handoff, context).id),
    })
  }),
)
