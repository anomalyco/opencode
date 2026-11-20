import { expect, test } from "bun:test"
import type { ImportedCookie } from "./cookie"
import { cookieKey, reconcileCookie, type LinkSide } from "./link-machine"

const sid = (value: string, extra: Partial<ImportedCookie> = {}): ImportedCookie => ({
  host: ".example.com",
  name: "sid",
  value,
  path: "/",
  secure: true,
  httpOnly: true,
  expires: 2_000_000_000,
  sameSite: "lax",
  ...extra,
})

test.each([
  { name: "both hold the same", base: undefined, profile: sid("a"), other: sid("a"), changed: "profile", write: undefined },
  { name: "neither holds it", base: sid("a"), profile: undefined, other: undefined, changed: "other", write: undefined },
  {
    name: "the profile changed",
    base: sid("a"),
    profile: sid("b"),
    other: sid("a"),
    changed: "profile",
    write: { to: "other", cookie: sid("b") },
  },
  {
    name: "the remote partition signed out",
    base: sid("a"),
    profile: sid("a"),
    other: undefined,
    changed: "other",
    write: { to: "profile", cookie: undefined },
  },
  {
    name: "an echo of the profile's change, handled as the other side's",
    base: sid("a"),
    profile: sid("b"),
    other: sid("a"),
    changed: "other",
    write: { to: "other", cookie: sid("b") },
  },
  {
    name: "two writes raced: the change being handled wins",
    base: sid("a"),
    profile: sid("b"),
    other: sid("c"),
    changed: "other",
    write: { to: "profile", cookie: sid("c") },
  },
  {
    name: "a cookie only the remote partition has, before anything was shared",
    base: undefined,
    profile: undefined,
    other: sid("r"),
    changed: "other",
    write: { to: "profile", cookie: sid("r") },
  },
  {
    name: "expiry read back with microseconds is the same expiry",
    base: undefined,
    profile: sid("a", { expires: 2_000_000_000.000_001 }),
    other: sid("a"),
    changed: "profile",
    write: undefined,
  },
  {
    name: "a session cookie and a persistent one differ",
    base: sid("a"),
    profile: sid("a", { expires: undefined }),
    other: sid("a"),
    changed: "profile",
    write: { to: "other", cookie: sid("a", { expires: undefined }) },
  },
] as const)("$name", (row) => {
  const step = reconcileCookie(row)

  expect(step.write).toEqual(row.write)
  // Once the write lands, both stores hold the new base.
  expect(step.base).toEqual(row.write ? row.write.cookie : row.profile)
})

/**
 * Two cookie stores with the mirror between them, driven the way Electron drives it: every store change, including
 * the mirror's own writes, is one event that reconciles its key. `refuse` lists the stores whose writes fail.
 */
function linked(initial: { profile?: ImportedCookie; other?: ImportedCookie }) {
  const stores: Record<LinkSide, Map<string, ImportedCookie>> = { profile: new Map(), other: new Map() }
  const base = new Map<string, ImportedCookie>()
  const refuse = new Set<LinkSide>()
  const key = cookieKey(sid(""))
  const writes: string[] = []

  const set = (side: LinkSide, cookie: ImportedCookie | undefined) => {
    if (cookie) stores[side].set(key, cookie)

    if (!cookie) stores[side].delete(key)
  }

  const reconcile = (side: LinkSide) => {
    const step = reconcileCookie({
      base: base.get(key),
      profile: stores.profile.get(key),
      other: stores.other.get(key),
      changed: side,
    })

    if (step.base) base.set(key, step.base)

    if (!step.base) base.delete(key)

    if (!step.write) return
    writes.push(`${step.write.to}:${step.write.cookie?.value ?? "removed"}`)

    if (!refuse.has(step.write.to)) change(step.write.to, step.write.cookie)
  }

  // A store change: the store emits one event, unless the write changed nothing, as Chromium does.
  function change(side: LinkSide, cookie: ImportedCookie | undefined) {
    if (stores[side].get(key) === cookie || (!cookie && !stores[side].has(key))) return
    set(side, cookie)
    reconcile(side)
  }

  set("profile", initial.profile)
  set("other", initial.other)

  return {
    change,
    refuse,
    writes,
    /** Linking compares every cookie the profile holds. */
    start: () => reconcile("profile"),
    value: (side: LinkSide) => stores[side].get(key)?.value,
  }
}

test("a removal the other store never saw leaves nothing that swallows a later sign-out", () => {
  const link = linked({ profile: sid("v1") })
  // The remote partition refuses the first copy, so it never holds the cookie.
  link.refuse.add("other")
  link.start()
  link.refuse.clear()

  // Signed out locally: the remote partition has nothing to remove.
  link.change("profile", undefined)
  // The remote server's page signs in, then out again.
  link.change("other", sid("v3"))
  expect(link.value("profile")).toBe("v3")
  link.change("other", undefined)

  expect(link.value("profile")).toBeUndefined()
  expect(link.value("other")).toBeUndefined()
})

test("every change goes across once, and its echo stops at the first comparison", () => {
  const link = linked({ profile: sid("v1") })
  link.start()
  link.change("profile", sid("v2"))
  link.change("other", sid("v3"))
  link.change("profile", undefined)

  expect(link.writes).toEqual(["other:v1", "other:v2", "profile:v3", "other:removed"])
  expect([link.value("profile"), link.value("other")]).toEqual([undefined, undefined])
})

test("an expired cookie that both stores drop writes nothing", () => {
  const link = linked({ profile: sid("v1") })
  link.start()
  link.change("profile", undefined)
  link.change("other", undefined)

  expect(link.writes).toEqual(["other:v1", "other:removed"])
})
