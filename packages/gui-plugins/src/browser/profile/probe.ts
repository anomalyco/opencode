import path from "node:path"
import type { Session } from "electron"
import { PROBE_COOKIE } from "./cookie"
import { snapshotDatabase } from "./database"

/**
 * Whether the profile's cookies reach its database. With cookie encryption on, Chromium writes no cookie at all while
 * the system key store refuses its key: a denied Keychain prompt, or a locked keyring. Writes one short-lived cookie,
 * flushes it and looks for it on disk. When the check itself cannot run, it says they do.
 */
export async function cookiesPersist(session: Session) {
  const written = await session.cookies
    .set({ url: PROBE_COOKIE.url, name: PROBE_COOKIE.name, value: "1", expirationDate: Date.now() / 1000 + 600 })
    .then(() => session.cookies.flushStore())
    .then(
      () => true,
      () => false,
    )

  if (!written || !session.storagePath) return true

  const storage = session.storagePath

  // Chromium keeps a partition's database under Network/ on some systems and beside it on others.
  const counts = await Promise.all(
    [path.join(storage, "Network", "Cookies"), path.join(storage, "Cookies")].map((file) =>
      snapshotDatabase(file, (db) =>
        db.prepare("SELECT count(*) AS count FROM cookies WHERE host_key = ? AND name = ?").get(PROBE_COOKIE.host, PROBE_COOKIE.name),
      )
        .then((row) => Number(row?.count ?? 0))
        .catch(() => undefined),
    ),
  )

  await session.cookies
    .remove(PROBE_COOKIE.url, PROBE_COOKIE.name)
    .then(() => session.cookies.flushStore())
    .catch(() => undefined)

  const read = counts.filter((count) => count !== undefined)

  return read.length === 0 || read.some((count) => count > 0)
}
