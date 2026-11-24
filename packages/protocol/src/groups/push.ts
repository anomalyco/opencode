import { Push } from "@opencode/schema/push"
import { Session } from "@opencode/schema/session"
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
  HttpApiEndpoint.patch("push.device.update", "/api/experimental/push/device/:id", {
    params: { id: Push.DeviceID },
    payload: Push.DevicePatch,
    success: Push.DevicePatch,
    error: [PushNotFoundError],
  }).annotateMerge(annotations("device.update", "Pause a phone", "Pause or resume notifications to one phone.")),
  HttpApiEndpoint.put("push.device.session.set", "/api/experimental/push/device/:id/session/:sessionID", {
    params: { id: Push.DeviceID, sessionID: Session.ID },
    payload: Push.Bell,
    success: Push.Bell,
    error: [InvalidRequestError, PushNotFoundError],
  }).annotateMerge(
    annotations("device.session.set", "Set a phone's session bell", "Choose what one phone gets for one session."),
  ),
  HttpApiEndpoint.delete("push.device.session.remove", "/api/experimental/push/device/:id/session/:sessionID", {
    params: { id: Push.DeviceID, sessionID: Session.ID },
    success: HttpApiSchema.NoContent,
    error: [PushNotFoundError],
  }).annotateMerge(
    annotations(
      "device.session.remove",
      "Clear a phone's session bell",
      "Let one phone follow the shared bell or its default for one session again.",
    ),
  ),
  HttpApiEndpoint.put("push.session.set", "/api/experimental/push/session/:sessionID", {
    params: { sessionID: Session.ID },
    payload: Push.Bell,
    success: Push.Bell,
    error: [InvalidRequestError, PushNotFoundError],
  }).annotateMerge(annotations("session.set", "Set a session bell", "Choose what every phone gets for one session.")),
  HttpApiEndpoint.delete("push.session.remove", "/api/experimental/push/session/:sessionID", {
    params: { sessionID: Session.ID },
    success: HttpApiSchema.NoContent,
    error: [PushNotFoundError],
  }).annotateMerge(
    annotations("session.remove", "Clear a session bell", "Let every phone follow its default for one session again."),
  ),
  HttpApiEndpoint.get("push.settings.get", "/api/experimental/push/settings", {
    success: Push.Settings,
    error: [PushNotFoundError],
  }).annotateMerge(annotations("settings.get", "Get the push pause", "Read whether all notifications are paused.")),
  HttpApiEndpoint.put("push.settings.set", "/api/experimental/push/settings", {
    payload: Push.Settings,
    success: Push.Settings,
    error: [InvalidRequestError, PushNotFoundError],
  }).annotateMerge(
    annotations("settings.set", "Pause all notifications", "Pause or resume notifications to every phone."),
  ),
] as const
