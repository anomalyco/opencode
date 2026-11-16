import { afterEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { cookieDetails } from "./cookie"
import { groupSites, siteFilter } from "./sites"
import { readSource, readSourceHosts } from "./sources"

const saved = { ...process.env }

afterEach(() => {
  Object.keys(process.env)
    .filter((key) => !(key in saved))
    .forEach((key) => delete process.env[key])
  Object.assign(process.env, saved)
})

// A made-up Firefox profile where this system's Firefox keeps its profiles, with every location the browser list
// reads pointed at a temporary directory, so no browser on this machine is read.
async function firefoxProfile() {
  const home = await mkdtemp(path.join(tmpdir(), "browser-sources-"))
  Object.assign(process.env, {
    HOME: home,
    USERPROFILE: home,
    APPDATA: path.join(home, "Roaming"),
    LOCALAPPDATA: path.join(home, "Local"),
    XDG_CONFIG_HOME: path.join(home, ".config"),
  })

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
  // A partitioned cookie of a chosen site, and a cookie of a container: neither imports.
  insert.run("github.com", "chips", "partitioned", "/", later, 1, 0, 0, "^partitionKey=%28https%2Ctop.test%29", 0)
  insert.run("github.com", "work", "container", "/", later, 1, 0, 0, "^userContextId=1", 0)
  insert.run(".bank.test", "session", "bank-secret", "/", later, 1, 1, 1, "", 9_000_000)
  insert.run("mail.test", "session", "mail-secret", "/", later, 1, 1, 1, "", 0)
  db.close()

  return home
}

test("lists a profile's sites from their hosts, and imports only the chosen ones' cookies", async () => {
  const home = await firefoxProfile()

  try {
    const hosts = await readSourceHosts("firefox", "Profiles/work.default")

    if ("failure" in hosts) throw new Error(`The made-up profile did not list: ${hosts.failure}`)
    expect(groupSites(hosts, Date.now() / 1000)).toEqual([
      { site: "bank.test", cookies: 1 },
      { site: "github.com", cookies: 3 },
      { site: "mail.test", cookies: 1 },
    ])

    const read = await readSource("firefox", "Profiles/work.default", siteFilter(["github.com"]))

    if ("failure" in read) throw new Error(`The made-up profile did not read: ${read.failure}`)
    // Domain cookies keep their domain and host-only cookies stay host-only once written.
    expect(read.cookies.map((cookie) => [cookie.name, cookie.value, cookieDetails(cookie)?.domain])).toEqual([
      ["user_session", "domain-secret", ".github.com"],
      ["_gh_sess", "host-secret", undefined],
      ["token", "api-secret", undefined],
    ])
    expect(read.cookies.map((cookie) => cookieDetails(cookie)?.url)).toEqual([
      "https://github.com/",
      "https://github.com/",
      "https://api.github.com/",
    ])
  } finally {
    await rm(home, { recursive: true, force: true }).catch(() => undefined)
  }
})

test("a profile that is not one this system's browsers list reads nothing", async () => {
  const home = await firefoxProfile()

  try {
    expect(await readSourceHosts("firefox", "../../elsewhere")).toEqual({ failure: "read" })
    expect(await readSource("firefox", "Profiles/missing", siteFilter(["github.com"]))).toEqual({ failure: "read" })
  } finally {
    await rm(home, { recursive: true, force: true }).catch(() => undefined)
  }
})
