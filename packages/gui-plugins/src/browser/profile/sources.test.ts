import { afterEach, expect, test } from "bun:test"
import { lutimes, mkdir, mkdtemp, readdir, rm, symlink, utimes, writeFile } from "node:fs/promises"
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

test("in the shared temporary directory, a planted link is left and a link inside a copy is never followed", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "browser-copies-"))
  const legacy = path.join(home, "temp")
  const victim = path.join(home, "victim")
  const old = new Date(Date.now() - 120_000)

  try {
    await mkdir(legacy, { recursive: true })
    await mkdir(victim)
    await writeFile(path.join(victim, "Cookies"), "the user's own file")
    // Another user's entry named as a copy, that points at the user's files; a junction needs no privilege on Windows.
    const planted = path.join(legacy, "opencode-browser-import-planted")
    await symlink(victim, planted, "junction")
    await lutimes(planted, old, old)
    // An old copy whose file was swapped for a link to the user's directory.
    const copy = path.join(legacy, "opencode-browser-import-copy")
    await mkdir(copy)
    await writeFile(path.join(copy, "Cookies-wal"), "values")
    await symlink(victim, path.join(copy, "Cookies"), "junction")
    await utimes(copy, old, old)
    // Earlier versions made no directory inside a copy, so the sweep never goes down into one.
    const nested = path.join(legacy, "opencode-browser-import-nested")
    await mkdir(path.join(nested, "inner"), { recursive: true })
    await writeFile(path.join(nested, "inner", "kept"), "")
    await utimes(nested, old, old)
    await utimes(victim, old, old)
    const logged: string[] = []

    await sweepSnapshots({ ...scratch(home), log: (_message, detail) => logged.push(path.basename(detail.directory ?? "")) }, [legacy])

    expect((await readdir(legacy)).toSorted()).toEqual(["opencode-browser-import-nested", "opencode-browser-import-planted"])
    expect(await readdir(path.join(nested, "inner"))).toEqual(["kept"])
    expect(await readdir(victim)).toEqual(["Cookies"])
    expect(logged).toEqual(["opencode-browser-import-nested"])
  } finally {
    await rm(home, { recursive: true, force: true }).catch(() => undefined)
  }
})