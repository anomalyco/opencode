import { HttpApiMiddleware } from "effect/http-api"
import { UnauthorizedError } from "../errors.js"

export class Authorization extends HttpApiMiddleware.Service<Authorization>()("@Mackery6969/HttpApiAuthorization", {
  error: UnauthorizedError,
}) {}
