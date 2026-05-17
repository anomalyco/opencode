import type { SessionResolver } from "@veritly/auth-shared"
import { workosSessionResolver } from "@veritly/auth-shared"

/**
 * Shared identity resolvers bound by univer-compat. Production and E2E use WorkOS
 * (`wos-session`); fast Bun tests may pass a different `SessionResolver` into `createCompatApp` only.
 */
export type CompatAuthenticator = SessionResolver

export const workosCompatResolver = workosSessionResolver()

export function resolverAuthenticator(auth: SessionResolver): CompatAuthenticator {
  return auth
}
