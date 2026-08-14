import { makeDefaultApi } from "@moks/protocol/api"
import { InvalidRequestError, SessionNotFoundError } from "@moks/protocol/errors"
import { HttpApiMiddleware } from "effect/unstable/httpapi"

class LocationMiddleware extends HttpApiMiddleware.Service<LocationMiddleware>()(
  "@moks/client/LocationMiddleware",
) {}

class SessionLocationMiddleware extends HttpApiMiddleware.Service<SessionLocationMiddleware>()(
  "@moks/client/SessionLocationMiddleware",
  { error: [InvalidRequestError, SessionNotFoundError] },
) {}

export const ClientApi = makeDefaultApi({
  locationMiddleware: LocationMiddleware,
  sessionLocationMiddleware: SessionLocationMiddleware,
})

export const groupNames = {
  "server.health": "health",
  "server.location": "location",
  "server.agent": "agents",
  "server.session": "sessions",
  "server.message": "messages",
  "server.model": "models",
  "server.provider": "providers",
  "server.integration": "integrations",
  "server.credential": "credentials",
  "server.permission": "permissions",
  "server.fs": "files",
  "server.command": "commands",
  "server.skill": "skills",
  "server.event": "events",
  "server.pty": "ptys",
  "server.question": "questions",
  "server.reference": "references",
  "server.projectCopy": "projectCopies",
} as const

export const endpointNames = {
  "session.messages": "list",
  "integration.connect.key": "connectKey",
  "integration.connect.oauth": "connectOauth",
  "integration.attempt.status": "attemptStatus",
  "integration.attempt.complete": "attemptComplete",
  "integration.attempt.cancel": "attemptCancel",
  "permission.request.list": "listRequests",
  "permission.saved.list": "listSaved",
  "permission.saved.remove": "removeSaved",
  "question.request.list": "listRequests",
} as const

export const omitEndpoints = new Set(["fs.read", "pty.connect", "pty.connectToken"])
