import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"

/**
 * A made-up Firefox profile where this system's Firefox keeps its profiles, under a new temporary home, and the
 * environment that points every location the browser list reads at that home, so no browser on this machine is read.
 * Its profile `Profiles/work.default` has cookies of github.com (a domain cookie, a host-only one and a subdomain's, plus
 * a partitioned and a container cookie that never import), bank.test and mail.test.
 */
export async function madeUpFirefox() {
  const home = await mkdtemp(path.join(tmpdir(), "browser-sources-"))

  const env = {
    // Windows finds browsers through APPDATA and LOCALAPPDATA; Electron does not start with another USERPROFILE.
    HOME: home,
    APPDATA: path.join(home, "Roaming"),
    LOCALAPPDATA: path.join(home, "Local"),
    XDG_CONFIG_HOME: path.join(home, ".config"),
  }

  const root =
    new Map([
      ["win32", path.join(home, "Roaming", "Mozilla", "Firefox")],
      ["darwin", path.join(home, "Library", "Application Support", "Firefox")],
    ]).get(process.platform) ?? path.join(home, ".mozilla", "firefox")

  await mkdir(path.join(root, "Profiles", "work.default"), { recursive: true })
  await writeFile(path.join(root, "profiles.ini"), "[Profile0]\nName=work\nIsRelative=1\nPath=Profiles/work.default\n")
  const db = new DatabaseSync(path.join(root, "Profiles", "work.default", "cookies.sqlite"))

  db.exec(
    "CREATE TABLE moz_cookies (host TEXT, name TEXT, value TEXT, path TEXT, expiry INTEGER, isSecure INTEGER, isHttpOnly INTEGER, sameSite INTEGER, originAttributes TEXT, lastAccessed INTEGER)",
  )

  const insert = db.prepare("INSERT INTO moz_cookies VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
  const later = Math.floor(Date.now() / 1000) + 86_400
  insert.run(".github.com", "user_session", "domain-secret", "/", later, 1, 1, 1, "", 3_000_000)
  insert.run("github.com", "_gh_sess", "host-secret", "/", later, 1, 1, 1, "", 2_000_000)
  insert.run("api.github.com", "token", "api-secret", "/", later, 1, 1, 0, "", 1_000_000)
  insert.run("github.com", "chips", "partitioned", "/", later, 1, 0, 0, "^partitionKey=%28https%2Ctop.test%29", 0)
  insert.run("github.com", "work", "container", "/", later, 1, 0, 0, "^userContextId=1", 0)
  insert.run(".bank.test", "session", "bank-secret", "/", later, 1, 1, 1, "", 9_000_000)
  insert.run("mail.test", "session", "mail-secret", "/", later, 1, 1, 1, "", 0)
  db.close()

  return { home, env }
}
