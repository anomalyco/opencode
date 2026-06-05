import { MoveSession } from "@opencode-ai/core/control-plane/move-session"
import { SessionV2 } from "@opencode-ai/core/session"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { RootHttpApi } from "../api"
import { ApiMoveSessionError, MoveSessionPayload } from "../groups/control-plane"

export const controlPlaneHandlers = HttpApiBuilder.group(RootHttpApi, "controlPlane", (handlers) =>
  Effect.gen(function* () {
    const service = yield* MoveSession.Service

    const moveSession = Effect.fn("ControlPlaneHttpApi.moveSession")(function* (ctx: {
      payload: typeof MoveSessionPayload.Type
    }) {
      yield* service.moveSession(ctx.payload).pipe(
        Effect.mapError(
          (error) =>
            new ApiMoveSessionError({
              name: "MoveSessionError",
              data: { message: message(error) },
            }),
        ),
      )
    })

    return handlers.handle("moveSession", moveSession)
  }),
)

function message(error: MoveSession.Error) {
  if (error instanceof SessionV2.NotFoundError) return `Session not found: ${error.sessionID}`
  if (error instanceof MoveSession.DestinationProjectMismatchError)
    return "Destination directory belongs to another project"
  return error.message
}
