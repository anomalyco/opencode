import { Context } from "effect"
import { ServerIdentity } from "@opencode/core/server-identity"

/**
 * The identity the authorization middleware verified for the current request, when the server runs local
 * accounts. Undefined for shared-password access and skipped routes, whose requests have no verified
 * session; handlers that attribute work to a user read its account and stay silent without one.
 */
export const RequestIdentity = Context.Reference<ServerIdentity.Verified | undefined>(
  "@opencode/ServerRequestIdentity",
  { defaultValue: () => undefined },
)
