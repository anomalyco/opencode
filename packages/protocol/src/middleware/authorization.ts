import { Context } from "effect"
import { HttpApiMiddleware } from "effect/unstable/httpapi"
import { UnauthorizedError } from "../errors.js"

export const HeaderOnlyAuthorization = Context.Reference<boolean>("@opencode/HttpApiAuthorization/HeaderOnly", {
  defaultValue: () => false,
})

export class Authorization extends HttpApiMiddleware.Service<Authorization>()("@opencode/HttpApiAuthorization", {
  error: UnauthorizedError,
}) {}
