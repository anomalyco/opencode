import { WORKOS_SESSION_COOKIE_NAME } from "@veritly/auth-shared"

/**
 * Headers to authenticate server tests with a **real** sealed WorkOS session
 * (same value as the `wos-session` browser cookie, or `export WORKOS_SESSION_DATA=...` from staging test session).
 */
export function workosSessionTestHeaders():
  | { headers: { cookie: string } }
  | { skip: true; reason: string } {
  const sealed = process.env["WORKOS_SESSION_DATA"]?.trim()
  if (!sealed) {
    return {
      skip: true,
      reason:
        "Set WORKOS_SESSION_DATA to a sealed session (e.g. `bun run staging:test-session` in packages/opencode, then export the printed line) so API tests use a real signed-in user.",
    }
  }
  const v = `${WORKOS_SESSION_COOKIE_NAME}=${encodeURIComponent(sealed)}`
  return { headers: { cookie: v } }
}
