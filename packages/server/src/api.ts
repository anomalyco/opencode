import { makeDefaultApi } from "@opencode-ai/protocol/api"
import { LocationMiddleware } from "./location"
import { FormLocationMiddleware } from "./middleware/form-location"
import { SessionLocationMiddleware } from "./middleware/session-location"

export const Api = makeDefaultApi({
  locationMiddleware: LocationMiddleware,
  // FormLocationMiddleware contains the temporary `sessionID === "global"` MCP elicitation hack.
  // Do not use that sentinel with general session APIs.
  formLocationMiddleware: FormLocationMiddleware,
  sessionLocationMiddleware: SessionLocationMiddleware,
})
