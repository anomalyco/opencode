import type { Context, Next } from "hono"
import type { SessionResolver } from "@veritly/auth-shared"
import { runWithRequestUserAsync } from "./request-user"
import { isUniverCompatPublicPath } from "./compat-public-path"

/**
 * Request header carrying the synthetic user id. Used only with `headerTestCompatResolver` and
 * `script/serve-header-test.ts` when Playwright sets `PLAYWRIGHT_UNIVER_HEADER_AUTH=1`.
 * Never use in production `serve.ts`.
 */
export const VERITLY_UNIVER_TEST_USER_HEADER = "x-veritly-univer-test-user"

/**
 * Identity = header value. Missing header on protected routes → 401. Invalid segment → 400.
 * No WorkOS, no `OPENCODE_E2E_USER_ID`, no fallbacks.
 */
export function univerCompatHeaderTestUserAuthMiddleware(auth: SessionResolver) {
  return async (c: Context, next: Next) => {
    const path = c.req.path
    if (isUniverCompatPublicPath(path)) {
      await next()
      return
    }

    try {
      const result = await auth.resolve(c.req.raw)
      if (!result.ok) return c.json({ error: result.message }, 401)
      await runWithRequestUserAsync(result.user.id, () => next())
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return c.json({ error: msg }, 400)
    }
  }
}
