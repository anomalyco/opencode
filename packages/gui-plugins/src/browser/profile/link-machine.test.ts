import { expect, test } from "bun:test"
import type { ImportedCookie } from "./cookie"
import {
  agreementKnown,
  cookieKey,
  cookieScope,
  copyingStores,
  initialMirrorState,
  planCopy,
  reconcileCookie,
  settledChange,
  transitionMirror,
  type CookieChange,
  type LinkSide,
  type MirrorEvent,
} from "./link-machine"

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

const at = (site: string, value: string) => sid(value, { host: `.${site}` })

test("the first copy plans, from each store's list, what reconciling every key by itself would write", () => {
  const profile = [at("same.example", "a"), at("profile.example", "p"), at("both.example", "mine")]
  const other = [at("same.example", "a"), at("remote.example", "r"), at("both.example", "theirs")]
  const plan = planCopy({ profile, other })

  // Every key through `reconcileCookie` with nothing agreed yet, handled as the store that holds it.
  const steps = [...new Set([...profile, ...other].map(cookieKey))].map((key) => {
    const mine = profile.find((item) => cookieKey(item) === key)

    return reconcileCookie({ base: undefined, profile: mine, other: other.find((item) => cookieKey(item) === key), changed: mine ? "profile" : "other" })
  })

  expect(plan.writes).toEqual(steps.flatMap((step) => (step.write?.cookie ? [{ to: step.write.to, cookie: step.write.cookie }] : [])))
  expect(plan.writes).toEqual([
    { to: "other", cookie: at("profile.example", "p") },
    // Both hold a different one: the profile's wins.
    { to: "other", cookie: at("both.example", "mine") },
    { to: "profile", cookie: at("remote.example", "r") },
  ])
  // What both stores hold once every write lands.
  expect([...plan.base.values()].map((item) => `${item.host}=${item.value}`).toSorted()).toEqual([
    ".both.example=mine",
    ".profile.example=p",
    ".remote.example=r",
    ".same.example=a",
  ])
})

test("stores that already hold the same cookies need no write", () => {
  const cookies = [at("a.example", "1"), at("b.example", "2")]

  expect(planCopy({ profile: cookies, other: cookies }).writes).toEqual([])
  expect(planCopy({ profile: [], other: [] })).toEqual({ base: new Map(), writes: [] })
})

test.each([
  { name: "a write's echo: the value both agreed on", base: sid("a"), cookie: sid("a"), removed: false, settled: true },
  { name: "a new value", base: sid("a"), cookie: sid("b"), removed: false, settled: false },
  { name: "a cookie neither store shared yet", base: undefined, cookie: sid("a"), removed: false, settled: false },
  { name: "a removal's echo: nothing was agreed", base: undefined, cookie: sid("a"), removed: true, settled: true },
  { name: "a sign-out", base: sid("a"), cookie: sid("a"), removed: true, settled: false },
  { name: "the same value that now ends with the session", base: sid("a"), cookie: sid("a", { expires: undefined }), removed: false, settled: false },
])("whether a change needs no read: $name", (row) => {
  expect(settledChange(row.base, { side: "other", cookie: row.cookie, removed: row.removed })).toBe(row.settled)
})

test.each([
  { name: "a domain cookie", host: ".example.com", path: "/", scope: "https://example.com/" },
  { name: "a host-only cookie", host: "www.example.com", path: "/", scope: "https://www.example.com/" },
  { name: "a cookie on a path", host: ".example.com", path: "/app/login", scope: "https://example.com/app/login" },
  { name: "an IPv6 host", host: "::1", path: "/", scope: "https://[::1]/" },
  // No address has these paths, so the store is asked for the key instead.
  { name: "a path with a space", host: ".example.com", path: "/a b", scope: undefined },
  { name: "a path with a query mark", host: ".example.com", path: "/a?b", scope: undefined },
  { name: "a path that is no path", host: ".example.com", path: "app", scope: undefined },
  { name: "no host", host: "", path: "/", scope: undefined },
])("the address a store is asked for one cookie with: $name", (row) => {
  expect(cookieScope(row)).toBe(row.scope)
})

const changeOf = (value: string): CookieChange => ({ side: "profile", cookie: sid(value), removed: false })

const played = (...events: MirrorEvent[]) =>
  events.reduce(
    (run, event) => {
      const next = transitionMirror(run.state, event)

      return { state: next.state, effects: [...run.effects, ...next.effects] }
    },
    { state: initialMirrorState, effects: new Array<ReturnType<typeof transitionMirror>["effects"][number]>() },
  )

test("changes wait for the first copy, and are reconciled in order once it ends", () => {
  const waiting = played({ type: "changed", change: changeOf("a") }, { type: "copy.planned" }, { type: "changed", change: changeOf("b") })

  expect(waiting.effects).toEqual([])
  expect(copyingStores(waiting.state)).toBe(true)
  const ended = transitionMirror(waiting.state, { type: "copy.ended" })

  expect(ended.state).toEqual({ status: "following" })
  expect(ended.effects).toEqual([
    { type: "reconcile", change: changeOf("a") },
    { type: "reconcile", change: changeOf("b") },
  ])
  expect(transitionMirror(ended.state, { type: "changed", change: changeOf("c") })).toEqual({
    state: { status: "following" },
    effects: [{ type: "reconcile", change: changeOf("c") }],
  })
})

test("what the stores agree on is known once both lists are read, not before", () => {
  expect(agreementKnown(initialMirrorState)).toBe(false)
  expect(agreementKnown(played({ type: "copy.planned" }).state)).toBe(true)
  expect(agreementKnown(played({ type: "copy.planned" }, { type: "copy.ended" }).state)).toBe(true)
  // A copy that failed before it read both lists is followed all the same.
  expect(agreementKnown(played({ type: "copy.ended" }).state)).toBe(true)
  expect(agreementKnown(played({ type: "stopped" }).state)).toBe(false)
})

test("a stopped mirror stays stopped, and the changes that waited are dropped", () => {
  const stopped = played({ type: "changed", change: changeOf("a") }, { type: "stopped" })

  expect(stopped.state).toEqual({ status: "stopped" })
  expect(copyingStores(stopped.state)).toBe(false)
  expect(played({ type: "changed", change: changeOf("a") }, { type: "stopped" }, { type: "copy.ended" }, { type: "changed", change: changeOf("b") })).toEqual({
    state: { status: "stopped" },
    effects: [],
  })
})
