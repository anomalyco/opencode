import { Effect, Stream } from "effect"
import { EventRpcs } from "../../shared/ipc-rpc"
import { IpcPortHandoff } from "../ipc-transport"

export const eventHandlers = EventRpcs.toLayer(
  Effect.gen(function* () {
    const handoff = yield* IpcPortHandoff

    return EventRpcs.of({
      DesktopEvents: (_request, context) => {
        const events = handoff.events(context.client.id)

        return events ? Stream.fromQueue(events) : Stream.empty
      },
    })
  }),
)
