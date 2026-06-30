import { InvalidRequestError, SessionNotFoundError } from "./errors"
import { makeDefaultApi } from "./api"
import { HttpApiMiddleware } from "effect/unstable/httpapi"

class LocationMiddleware extends HttpApiMiddleware.Service<LocationMiddleware>()(
  "@opencode-ai/client/LocationMiddleware",
) {}

class SessionLocationMiddleware extends HttpApiMiddleware.Service<SessionLocationMiddleware>()(
  "@opencode-ai/client/SessionLocationMiddleware",
  { error: [InvalidRequestError, SessionNotFoundError] },
) {}

export const ClientApi = makeDefaultApi({
  locationMiddleware: LocationMiddleware,
  sessionLocationMiddleware: SessionLocationMiddleware,
})

export const groupNames = {
  "server.health": "health",
  "server.location": "location",
  "server.agent": "agent",
  "server.session": "session",
  "server.message": "message",
  "server.model": "model",
  "server.generate": "generate",
  "server.provider": "provider",
  "server.integration": "integration",
  "server.credential": "credential",
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
} as const

export const endpointNames = {
  "session.messages": "list",
  "integration.connect.key": "connectKey",
  "integration.connect.oauth": "connectOauth",
  "integration.attempt.status": "attemptStatus",
  "integration.attempt.complete": "attemptComplete",
  "integration.attempt.cancel": "attemptCancel",
  "session.revert.stage": "revertStage",
  "session.revert.clear": "revertClear",
  "session.revert.commit": "revertCommit",
  "permission.request.list": "listRequests",
  "permission.saved.list": "listSaved",
  "permission.saved.remove": "removeSaved",
  "question.request.list": "listRequests",
} as const

export const promiseOmitEndpoints = new Set(["pty.connect", "pty.connectToken"])
export const effectOmitEndpoints = new Set(["fs.read", "pty.connect", "pty.connectToken"])
