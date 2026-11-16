import { HttpApiMiddleware } from "effect/http-api"
import { UnknownError } from "../errors.js"

/**
 * Declares the readable 500 that replaces Effect's empty response for a defect.
 *
 * The replacement runs for every endpoint, so this middleware declares `UnknownError` on the whole API and the
 * generated contract (OpenAPI, clients) describes the 500 instead of leaving consumers to discard its body.
 */
export class DefectResponseMiddleware extends HttpApiMiddleware.Service<DefectResponseMiddleware>()(
  "@opencode/HttpApiDefectResponse",
  { error: UnknownError },
) {}
