import type { SessionResolver } from "@veritly/auth-shared"
import { headerSessionResolver, workosSessionResolver } from "@veritly/auth-shared"
import { VERITLY_UNIVER_TEST_USER_HEADER } from "./auth-test-header"
import { assertSafeUserSegment } from "./object-keys"

/**
 * Shared identity resolvers bound by univer-compat. Production uses WorkOS; tests and the
 * Playwright header stack use the synthetic header resolver — no env backdoors.
 */
export type CompatAuthenticator = SessionResolver

export const workosCompatResolver = workosSessionResolver()

export const headerTestCompatResolver = headerSessionResolver(
  VERITLY_UNIVER_TEST_USER_HEADER,
  assertSafeUserSegment,
)

export function resolverAuthenticator(auth: SessionResolver): CompatAuthenticator {
  return auth
}
