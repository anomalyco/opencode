import { Push } from "@opencode/schema/push"
import { HttpApiEndpoint, HttpApiSchema, OpenApi } from "effect/http-api"
import { InvalidRequestError, PushNotFoundError } from "../errors.js"

const EXPERIMENTAL = "Behind the push flag. Experimental: may change without compatibility guarantees."

const annotations = (identifier: string, summary: string, description: string) =>
  OpenApi.annotations({
    identifier: `experimental.push.${identifier}`,
    summary,
    description: `${description} ${EXPERIMENTAL}`,
    transform: (operation) => ({ ...operation, tags: ["experimental"] }),
  })

/** Lives in the `server.experimental` group (see `groups/experimental.ts`). */
export const PushEndpoints = [
  HttpApiEndpoint.get("push.get", "/api/experimental/push", {
    success: Push.Info,
    error: [PushNotFoundError],
  }).annotateMerge(
    annotations(
      "get",
      "Get push settings",
      "List the registered phones with their choices, bells and pauses, the server-wide pause and the shared session bells. Never returns callback URLs or keys.",
    ),
  ),
  HttpApiEndpoint.put("push.device.register", "/api/experimental/push/device/:id", {
    params: { id: Push.DeviceID },
    payload: Push.Register,
    success: Push.Registered,
    error: [InvalidRequestError, PushNotFoundError],
  }).annotateMerge(
    annotations(
      "device.register",
      "Register a phone",
      "Register or renew a phone's relay callback URL and public key, and answer with the server's public key for it. Keeps the phone's pause and session bells.",
    ),
  ),
  HttpApiEndpoint.delete("push.device.remove", "/api/experimental/push/device/:id", {
    params: { id: Push.DeviceID },
    success: HttpApiSchema.NoContent,
    error: [PushNotFoundError],
  }).annotateMerge(annotations("device.remove", "Remove a phone", "Stop sending notifications to a phone.")),
] as const
