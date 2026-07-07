import { InvalidRequestError, SessionNotFoundError } from "./errors.js"
import { makeDefaultApi } from "./api.js"
import type { Api } from "./api.js"
import type { Context } from "effect"
import { HttpApiMiddleware } from "effect/unstable/httpapi"
import type { EventGroup } from "./groups/event.js"

class LocationMiddleware extends HttpApiMiddleware.Service<LocationMiddleware>()(
  "@opencode-ai/client/LocationMiddleware",
) {}

class SessionLocationMiddleware extends HttpApiMiddleware.Service<SessionLocationMiddleware>()(
  "@opencode-ai/client/SessionLocationMiddleware",
  { error: [InvalidRequestError, SessionNotFoundError] },
) {}

type ClientApiShape = Api<
  Context.Service.Identifier<typeof LocationMiddleware>,
  Context.Service.Shape<typeof LocationMiddleware>,
  Context.Service.Identifier<typeof SessionLocationMiddleware>,
  Context.Service.Shape<typeof SessionLocationMiddleware>,
  Context.Service.Identifier<typeof SessionLocationMiddleware>,
  Context.Service.Shape<typeof SessionLocationMiddleware>,
  typeof EventGroup
>

export const ClientApi: ClientApiShape = makeDefaultApi({
  locationMiddleware: LocationMiddleware,
  // The real server uses a form-specific middleware with an undocumented `global` sentinel branch.
  // The generated client only needs a middleware identity for API typing.
  formLocationMiddleware: SessionLocationMiddleware,
  sessionLocationMiddleware: SessionLocationMiddleware,
})

export const groupNames = {
  "server.health": "health",
  "server.debug": "debug",
  "server.location": "location",
  "server.agent": "agent",
  "server.plugin": "plugin",
  "server.session": "session",
  "server.message": "message",
  "server.model": "model",
  "server.generate": "generate",
  "server.provider": "provider",
  "server.integration": "integration",
  "server.credential": "credential",
  "server.form": "form",
  "server.permission": "permission",
  "server.fs": "file",
  "server.command": "command",
  "server.skill": "skill",
  "server.event": "event",
  "server.pty": "pty",
  "server.shell": "shell",
  "server.question": "question",
  "server.reference": "reference",
  "server.project": "project",
  "server.projectCopy": "projectCopy",
  "server.vcs": "vcs",
} as const

export const endpointNames = {
  "debug.location.evict": "evictLocation",
  "session.messages": "list",
  "integration.connect.key": "connectKey",
  "integration.connect.oauth": "connectOauth",
  "integration.attempt.status": "attemptStatus",
  "integration.attempt.complete": "attemptComplete",
  "integration.attempt.cancel": "attemptCancel",
  "session.instructions.entry.list": ["instructions", "entry", "list"],
  "session.instructions.entry.put": ["instructions", "entry", "put"],
  "session.instructions.entry.remove": ["instructions", "entry", "remove"],
  "session.revert.stage": "revertStage",
  "session.revert.clear": "revertClear",
  "session.revert.commit": "revertCommit",
  "permission.request.list": "listRequests",
  "permission.saved.list": "listSaved",
  "permission.saved.remove": "removeSaved",
  "form.request.list": "listRequests",
  "question.request.list": "listRequests",
} as const

export const promiseOmitEndpoints = new Set(["pty.connect", "pty.connectToken"])
export const effectOmitEndpoints = new Set(["fs.read", "pty.connect", "pty.connectToken"])
