import { afterEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { cookieDetails } from "./cookie"
import { groupSites, siteFilter } from "./sites"
import { sweepSnapshots, type SnapshotScratch } from "./database"
import { madeUpFirefox } from "./made-up-firefox.fixture"
import { readSource, readSourceHosts } from "./sources"

// Copies go under the made-up home, as the profile puts them under the app's data.
const scratch = (home: string): SnapshotScratch => ({ directory: path.join(home, "copies"), live: new Set(), log: () => undefined })

const saved = { ...process.env }

afterEach(() => {
  Object.keys(process.env)
    .filter((key) => !(key in saved))
    .forEach((key) => delete process.env[key])
  Object.assign(process.env, saved)
})

async function firefoxProfile() {
  const made = await madeUpFirefox()
  Object.assign(process.env, made.env)

  return made.home
}

test("lists a profile's sites from their hosts, and imports only the chosen ones' cookies", async () => {
  const home = await firefoxProfile()

  try {
    const hosts = await readSourceHosts("firefox", "Profiles/work.default", scratch(home))

    if ("failure" in hosts) throw new Error(`The made-up profile did not list: ${hosts.failure}`)
    expect(groupSites(hosts, Date.now() / 1000)).toEqual([
      { site: "bank.test", cookies: 1 },
      { site: "github.com", cookies: 3 },
      { site: "mail.test", cookies: 1 },
    ])

    const read = await readSource("firefox", "Profiles/work.default", scratch(home), siteFilter(["github.com"]))

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
    expect(await readSourceHosts("firefox", "../../elsewhere", scratch(home))).toEqual({ failure: "read" })
    expect(await readSource("firefox", "Profiles/missing", scratch(home), siteFilter(["github.com"]))).toEqual({ failure: "read" })
  } finally {
    await rm(home, { recursive: true, force: true }).catch(() => undefined)
  }
})

test("sweeps the copies a crash left behind, but never one a read still uses", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "browser-copies-"))
  const copies = { ...scratch(home), log: (message: string, detail: Record<string, string>) => logged.push([message, detail.directory ?? ""]) }
  const logged: [string, string][] = []
  const legacy = path.join(home, "temp")

  try {
    const left = path.join(copies.directory, "opencode-browser-import-left")
    const reading = path.join(copies.directory, "opencode-browser-import-reading")
    const oldTemp = path.join(legacy, "opencode-browser-import-old")
    const newTemp = path.join(legacy, "opencode-browser-import-new")
    const unrelated = path.join(copies.directory, "something-else")
    await Promise.all([left, reading, oldTemp, newTemp, unrelated].map((directory) => mkdir(directory, { recursive: true })))
    await writeFile(path.join(left, "cookies.sqlite"), "values")
    // Another app instance's copy in the temporary folder may still be read; one older than a minute is not.
    await utimes(oldTemp, new Date(Date.now() - 120_000), new Date(Date.now() - 120_000))
    copies.live.add(reading)

    await sweepSnapshots(copies, [legacy])

    const remaining = async (directory: string) => (await readdir(directory)).toSorted()
    expect(await remaining(copies.directory)).toEqual(["opencode-browser-import-reading", "something-else"])
    expect(await remaining(legacy)).toEqual(["opencode-browser-import-new"])
    expect(logged).toEqual([])
  } finally {
    await rm(home, { recursive: true, force: true }).catch(() => undefined)
  }
})