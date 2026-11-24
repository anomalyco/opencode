import type { Session } from "electron"
import { cookieDetails, type CookieRead } from "./cookie"
import type { ImportResult } from "./ipc"

/**
 * Writes what an import read into a session's cookie store and says how it went. Cookies already there stay, so a
 * later import adds sites. With `chosen`, the person picked sites from a list that offered no expired or partitioned
 * cookie, so those are not counted as left behind.
 */
export async function writeCookies(
  session: Session,
  read: CookieRead,
  chosen: boolean,
): Promise<Extract<ImportResult, { type: "imported" }>> {
  const now = Date.now() / 1000
  const writes = read.cookies.flatMap((cookie) => cookieDetails(cookie, now) ?? [])

  const results = await Promise.all(
    writes.map((cookie) =>
      session.cookies.set(cookie).then(
        () => true,
        () => false,
      ),
    ),
  )

  await session.cookies.flushStore()
  const imported = results.filter(Boolean).length

  return {
    type: "imported",
    imported,
    skipped: chosen ? 0 : (read.skipped ?? 0) + read.cookies.length - writes.length,
    protected: read.protected,
    failed: read.failed + writes.length - imported,
  }
}
