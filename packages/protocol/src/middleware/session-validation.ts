import { HttpApiMiddleware } from "effect/unstable/httpapi"
import { InvalidRequestError, SessionNotFoundError } from "../errors.js"

export class SessionValidationMiddleware extends HttpApiMiddleware.Service<SessionValidationMiddleware>()(
  "@opencode/HttpApiSessionValidation",
  { error: [InvalidRequestError, SessionNotFoundError] },
) {}
