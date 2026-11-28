import { expect, test } from "bun:test"
import { createCookieMirror, createSignInLinks, type MirroredSession } from "./link"

type Listener = Parameters<MirroredSession["cookies"]["on"]>[1]

/** While `list` is set, a read of the store's whole list waits for it; a rejection fails the read. */
type Gate = { list?: Promise<void> }

type Logged = { readonly level: string; readonly message: string; readonly data: Readonly<Record<string, number | string>> }

const cookie = (site: number, value: string, extra: Partial<Electron.Cookie> = {}): Electron.Cookie => ({
  name: "sid",
  value,
  domain: `.site-${site}.example`,
  hostOnly: false,
  path: "/",
  secure: true,
  httpOnly: true,
  session: false,
  expirationDate: 2_000_000_000,
  sameSite: "lax",
  ...extra,
})

const many = (count: number, value = "v1") => Array.from({ length: count }, (_, site) => cookie(site, value))

const place = (item: Electron.Cookie) => `${item.domain}\n${item.path}\n${item.name}`

// Whether a store sends `item` to `host`: a domain cookie to its domain and every host under it, a host-only one to
// its host alone.
const sentTo = (item: Electron.Cookie, host: string) => {
  const domain = item.domain ?? ""

  return domain.startsWith(".") ? host === domain.slice(1) || host.endsWith(domain) : host === domain
}

/**
 * A cookie store as the mirror sees an Electron session's, which counts what it is asked. `lists` are reads of every
 * cookie the store holds; `sites` are reads of one site's cookies by address and name; `keys` are reads of one cookie
 * by domain, path and name, which Electron answers by fetching every cookie the store holds. A write that changes
 * something reports the change to the listeners, as Chromium does: an overwrite reports the old cookie's removal
 * first, and a write that changes nothing reports nothing.
 */
function createStore(initial: readonly Electron.Cookie[] = []) {
  const cookies = new Map(initial.map((item) => [place(item), item]))
  const listeners = new Set<Listener>()
  const calls = { lists: 0, sites: 0, keys: 0, sets: 0, removes: 0 }
  const gate: Gate = {}

  const report = (item: Electron.Cookie, cause: string, removed: boolean) =>
    queueMicrotask(() =>
      listeners.forEach((listener) => {
        // SAFETY: the mirror reads the cookie, the cause and `removed`, never the event.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see SAFETY above
        listener({} as Electron.Event, item, cause, removed)
      }),
    )

  const put = (item: Electron.Cookie) => {
    const old = cookies.get(place(item))

    if (old && JSON.stringify(old) === JSON.stringify(item)) return

    if (old) report(old, "overwrite", true)
    cookies.set(place(item), item)
    report(item, "explicit", false)
  }

  const drop = (item: Electron.Cookie) => {
    if (cookies.delete(place(item))) report(item, "explicit", true)
  }

  // A `Set-Cookie` with `Max-Age=0` or a past `Expires`: Chromium reports the removal as an expired overwrite, and no
  // insert follows.
  const expire = (item: Electron.Cookie) => {
    if (cookies.delete(place(item))) report(item, "expired-overwrite", true)
  }

  const session: MirroredSession = {
    cookies: {
      async get(filter) {
        if (filter.url) {
          calls.sites += 1
          const url = new URL(filter.url)

          return [...cookies.values()].filter(
            (item) => item.name === filter.name && sentTo(item, url.hostname) && url.pathname.startsWith(item.path ?? "/"),
          )
        }

        if (filter.domain) {
          calls.keys += 1

          return [...cookies.values()].filter(
            (item) => item.name === filter.name && item.path === filter.path && sentTo(item, filter.domain ?? ""),
          )
        }

        calls.lists += 1
        await gate.list

        return [...cookies.values()]
      },
      async set(details) {
        calls.sets += 1
        put({
          name: details.name ?? "",
          value: details.value ?? "",
          domain: details.domain ? `.${details.domain.replace(/^\./, "")}` : new URL(details.url).hostname,
          hostOnly: !details.domain,
          path: details.path ?? "/",
          secure: details.secure ?? false,
          httpOnly: details.httpOnly ?? false,
          session: details.expirationDate === undefined,
          expirationDate: details.expirationDate,
          sameSite: details.sameSite ?? "unspecified",
        })
      },
      async remove(address, name) {
        calls.removes += 1
        const url = new URL(address)

        const sent = [...cookies.values()].filter(
          (item) => item.name === name && sentTo(item, url.hostname) && url.pathname.startsWith(item.path ?? "/"),
        )

        sent.forEach(drop)
      },
      on: (_event, listener) => void listeners.add(listener),
      off: (_event, listener) => void listeners.delete(listener),
    },
  }

  return {
    session,
    calls,
    gate,
    /** A page of the store writes a cookie, or signs out. */
    page: { set: put, remove: drop, expire, report },
    size: () => cookies.size,
    value: (site: number, path = "/") => cookies.get(place(cookie(site, "", { path })))?.value,
    listening: () => listeners.size,
  }
}

/** Lets everything the stores and the mirror have queued run, until a whole turn of the loop queues no call. */
async function settled(...stores: ReturnType<typeof createStore>[]) {
  const count = () => JSON.stringify(stores.map((store) => store.calls))

  for (let before = ""; before !== count(); ) {
    before = count()
    await new Promise<void>((resolve) => setImmediate(resolve))
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
}

function mirrored(profile: ReturnType<typeof createStore>, other: ReturnType<typeof createStore>) {
  const logged: Logged[] = []

  const mirror = createCookieMirror({
    profile: profile.session,
    other: other.session,
    log: (level, message, data) => void logged.push({ level, message, data }),
  })

  return { mirror, logged, lines: () => logged.map((line) => line.message) }
}

const NONE = { lists: 0, sites: 0, keys: 0, sets: 0, removes: 0 }

// The first copy read both stores once per cookie, and each of those reads fetched every cookie the store holds: with
// 3,000 sign-ins that was 12,000 reads of 3,000 cookies each, which kept the app's main process and Chromium's
// network service busy for minutes. It now reads each store's list once.
test("3,000 sign-ins both stores already share: each store's list is read once, and nothing is read or written per cookie", async () => {
  const profile = createStore(many(3_000))
  const other = createStore(many(3_000))
  const { mirror, logged } = mirrored(profile, other)
  await mirror.started
  await settled(profile, other)

  expect(profile.calls).toEqual({ ...NONE, lists: 1 })
  expect(other.calls).toEqual({ ...NONE, lists: 1 })
  expect(logged.map((line) => line.message)).toEqual(["browser sign-in copy started", "browser sign-in copy finished"])
  expect(logged[1]?.data).toMatchObject({ profile: 3_000, remote: 3_000, toRemote: 0, toProfile: 0, refused: 0 })
  expect(logged[1]?.data.copy).toBe(logged[0]?.data.copy ?? "")
  await mirror.stop(false)
})

test("3,000 sign-ins only the profile holds: 3,000 writes into the partition, whose echoes cost no read", async () => {
  const profile = createStore(many(3_000))
  const other = createStore()
  const { mirror, logged } = mirrored(profile, other)
  await mirror.started
  await settled(profile, other)

  expect(profile.calls).toEqual({ ...NONE, lists: 1 })
  expect(other.calls).toEqual({ ...NONE, lists: 1, sets: 3_000 })
  expect(other.size()).toBe(3_000)
  expect(logged[1]?.data).toMatchObject({ profile: 3_000, remote: 0, toRemote: 3_000, toProfile: 0, refused: 0 })
  await mirror.stop(false)
})

test("a sign-in only the partition holds goes to the profile, and where both hold one the profile's wins", async () => {
  const profile = createStore([cookie(1, "profile")])
  const other = createStore([cookie(1, "remote"), cookie(2, "remote")])
  const { mirror, logged } = mirrored(profile, other)
  await mirror.started
  await settled(profile, other)

  expect([profile.value(1), profile.value(2), other.value(1), other.value(2)]).toEqual(["profile", "remote", "profile", "remote"])
  expect(logged[1]?.data).toMatchObject({ profile: 1, remote: 2, toRemote: 1, toProfile: 1 })
  expect(profile.calls.sites + profile.calls.keys + other.calls.sites + other.calls.keys).toBe(0)
  await mirror.stop(false)
})

test.each([10, 3_000])("a page changes one of %i sign-ins: each store is asked for that one site's cookie, once", async (count) => {
  const profile = createStore(many(count))
  const other = createStore()
  const { mirror } = mirrored(profile, other)
  await mirror.started
  await settled(profile, other)
  const before = { profile: { ...profile.calls }, other: { ...other.calls } }
  profile.page.set(cookie(7, "v2"))
  await settled(profile, other)

  expect(other.value(7)).toBe("v2")
  // One read per store for the change, one write, and nothing for the write's echo.
  expect(profile.calls).toEqual({ ...before.profile, sites: 1 })
  expect(other.calls).toEqual({ ...before.other, sites: 1, sets: before.other.sets + 1 })

  // The remote server's page signs out: the profile does too, with one read per store again.
  other.page.remove(cookie(7, "v2"))
  await settled(profile, other)

  expect(profile.value(7)).toBeUndefined()
  expect(profile.calls).toEqual({ ...before.profile, sites: 2, removes: 1 })
  expect(other.calls).toEqual({ ...before.other, sites: 2, sets: before.other.sets + 1 })
  await mirror.stop(false)
})

test("a page that signs out by expiring its cookie signs the other store out too", async () => {
  const profile = createStore([cookie(1, "v1"), cookie(2, "v1")])
  const other = createStore([cookie(1, "v1"), cookie(2, "v1")])
  const { mirror } = mirrored(profile, other)
  await mirror.started
  await settled(profile, other)
  other.page.expire(cookie(1, "v1"))
  profile.page.expire(cookie(2, "v1"))
  await settled(profile, other)

  expect([profile.value(1), other.value(1), profile.value(2), other.value(2)]).toEqual([undefined, undefined, undefined, undefined])
  expect(profile.calls.removes + other.calls.removes).toBe(2)
  await mirror.stop(false)
})

test("a store that reports a sign-in both stores already hold, or the removal of one neither holds, is asked nothing", async () => {
  const profile = createStore(many(10))
  const other = createStore(many(10))
  const { mirror } = mirrored(profile, other)
  await mirror.started
  await settled(profile, other)
  profile.page.report(cookie(3, "v1"), "explicit", false)
  other.page.report(cookie(3, "v1"), "explicit", false)
  other.page.report(cookie(99, "gone"), "expired", true)
  await settled(profile, other)

  expect(profile.calls).toEqual({ ...NONE, lists: 1 })
  expect(other.calls).toEqual({ ...NONE, lists: 1 })
  await mirror.stop(false)
})

test("a cookie on a path no address names is asked for by its key", async () => {
  const odd = cookie(1, "v1", { path: "/a b" })
  const profile = createStore([odd])
  const other = createStore()
  const { mirror } = mirrored(profile, other)
  await mirror.started
  await settled(profile, other)
  profile.page.set({ ...odd, value: "v2" })
  await settled(profile, other)

  expect(profile.calls).toMatchObject({ lists: 1, sites: 0, keys: 1 })
  expect(other.calls).toMatchObject({ lists: 1, sites: 0, keys: 1 })
  await mirror.stop(false)
})

test("a change a store reports while the copy runs is reconciled once the copy ends", async () => {
  const profile = createStore([cookie(1, "v1")])
  const other = createStore()
  const held = Promise.withResolvers<void>()
  other.gate.list = held.promise
  const { mirror } = mirrored(profile, other)
  // While the partition's list is still being read, the profile signs in to a second site and out of the first.
  profile.page.set(cookie(2, "late"))
  profile.page.remove(cookie(1, "v1"))
  await settled(profile, other)
  expect(other.calls.sets).toBe(0)
  held.resolve()
  await mirror.started
  await settled(profile, other)

  expect([other.value(1), other.value(2)]).toEqual([undefined, "late"])
  expect([profile.value(1), profile.value(2)]).toEqual([undefined, "late"])
  await mirror.stop(false)
})

test("stopping the mirror ends its copy at the next batch of writes, and the log says so", async () => {
  const profile = createStore(many(3_000))
  const other = createStore()
  const { mirror, lines, logged } = mirrored(profile, other)

  while (!other.calls.sets) await new Promise<void>((resolve) => setImmediate(resolve))
  await mirror.stop(false)
  await mirror.started
  await settled(profile, other)

  expect(other.calls.sets).toBeLessThan(100)
  expect(lines()).toEqual(["browser sign-in copy started", "browser sign-in copy cancelled"])
  expect(logged[1]?.data.written).toBe(other.calls.sets)
  expect([profile.listening(), other.listening()]).toEqual([0, 0])
  // Nothing follows a stopped mirror.
  profile.page.set(cookie(1, "v2"))
  await settled(profile, other)
  expect(profile.calls.sites + other.calls.sites).toBe(0)
})

test("a store that cannot be listed fails the copy, which the log says, and its changes are still followed", async () => {
  const profile = createStore(many(5))
  const other = createStore()
  profile.gate.list = Promise.reject(new Error("store closed"))
  const { mirror, logged } = mirrored(profile, other)
  await mirror.started

  expect(logged.map((line) => `${line.level} ${line.message}`)).toEqual(["info browser sign-in copy started", "warn browser sign-in copy failed"])
  expect(logged[1]?.data.cause).toBe("Error: store closed")
  profile.page.set(cookie(1, "v2"))
  await settled(profile, other)

  expect(other.value(1)).toBe("v2")
  await mirror.stop(false)
})

test("a cookie a store refuses is counted and named in the log, and the rest of the copy goes on", async () => {
  const profile = createStore(many(40))
  const other = createStore()
  const set = other.session.cookies.set

  other.session.cookies.set = (details) => (details.url.includes("site-7.") ? Promise.reject(new Error("refused")) : set(details))
  const { mirror, logged } = mirrored(profile, other)
  await mirror.started
  await settled(profile, other)

  expect(other.size()).toBe(39)
  expect(logged[1]).toMatchObject({ level: "warn", message: "browser sign-in copy finished", data: { toRemote: 40, refused: 1, cause: "Error: refused" } })
  await mirror.stop(false)
})

test("no longer sharing sign-ins removes the shared cookies from the partition and leaves the profile's", async () => {
  const profile = createStore(many(50))
  const other = createStore()
  const { mirror } = mirrored(profile, other)
  await mirror.started
  await mirror.stop(true)
  await settled(profile, other)

  expect([profile.size(), other.size()]).toEqual([50, 0])
  expect(profile.calls).toEqual({ ...NONE, lists: 1 })
})

test("a shared cookie the partition does not let go is counted in the log", async () => {
  const profile = createStore(many(5))
  const other = createStore()
  const remove = other.session.cookies.remove
  other.session.cookies.remove = (url, name) => (url.includes("site-2.") ? Promise.reject(new Error("held")) : remove(url, name))
  const { mirror, logged } = mirrored(profile, other)
  await mirror.started
  await mirror.stop(true)

  expect(other.size()).toBe(1)
  expect(logged.at(-1)).toMatchObject({ level: "warn", message: "browser shared sign-ins were not removed", data: { kept: 1, cause: "Error: held" } })
})

// ---- A partition's link: what its pane waits for ----

function linkedStores(input: { profile: ReturnType<typeof createStore>; sharing: boolean }) {
  const logged: Logged[] = []
  const sharing = { on: input.sharing }

  const links = createSignInLinks({
    profile: input.profile.session,
    sharing: () => sharing.on,
    log: (level, message, data) => void logged.push({ level, message, data }),
  })

  return { links, sharing, lines: () => logged.map((line) => line.message) }
}

// Attaching a pane to a remote server waited for the whole copy. A copy that outlasted the attachment's 15 seconds
// made the window register again, which started one more copy beside the first.
test("linking a partition returns while its copy is under way, and only a page about to load waits for it", async () => {
  const profile = createStore(many(100))
  const other = createStore()
  const held = Promise.withResolvers<void>()
  profile.gate.list = held.promise
  const { links, lines } = linkedStores({ profile, sharing: true })
  // Returned, not awaited: the pane goes on to attach.
  const link = links.link(other.session)
  const page = link.signedIn(new AbortController().signal)
  const again = link.signedIn(new AbortController().signal)
  const waited = { page: false }
  void page?.then(() => (waited.page = true))
  await settled(profile, other)

  // Still copying, however long that takes: the page waits, and waiting starts no second copy.
  expect(waited.page).toBe(false)
  expect([profile.calls.lists, other.calls.lists]).toEqual([1, 1])
  held.resolve()
  await Promise.all([page, again])
  await settled(profile, other)

  expect(other.size()).toBe(100)
  expect([profile.calls.lists, other.calls.lists]).toEqual([1, 1])
  expect(lines()).toEqual(["browser sign-in copy started", "browser sign-in copy finished"])
  // Once the copy ended a page waits for nothing.
  expect(link.signedIn(new AbortController().signal)).toBeUndefined()
  link.unlink()
})

test("a partition unlinked while its copy is under way has the copy cancelled", async () => {
  const profile = createStore(many(3_000))
  const other = createStore()
  const { links, lines } = linkedStores({ profile, sharing: true })
  const link = links.link(other.session)

  while (!other.calls.sets) await new Promise<void>((resolve) => setImmediate(resolve))
  // The registration ends: its window closed, or it registered again.
  link.unlink()
  await settled(profile, other)

  expect(other.calls.sets).toBeLessThan(100)
  expect(lines()).toEqual(["browser sign-in copy started", "browser sign-in copy cancelled"])
  expect([profile.listening(), other.listening()]).toEqual([0, 0])
})

test("a page that stops waiting leaves the copy to finish", async () => {
  const profile = createStore(many(20))
  const other = createStore()
  const held = Promise.withResolvers<void>()
  profile.gate.list = held.promise
  const { links, lines } = linkedStores({ profile, sharing: true })
  const link = links.link(other.session)
  const stop = new AbortController()
  const page = link.signedIn(stop.signal)
  stop.abort(new Error("stopped"))

  await expect(page).rejects.toThrow("stopped")
  held.resolve()
  await settled(profile, other)
  await settled(profile, other)

  expect(other.size()).toBe(20)
  expect(lines()).toEqual(["browser sign-in copy started", "browser sign-in copy finished"])
  links.dispose()
})

test("a partition gets nothing until sign-ins are shared, and sharing them waits for no copy", async () => {
  const profile = createStore(many(20))
  const other = createStore()
  const { links, sharing, lines } = linkedStores({ profile, sharing: false })
  const link = links.link(other.session)
  await settled(profile, other)

  expect([profile.calls, other.calls]).toEqual([NONE, NONE])
  expect(link.signedIn(new AbortController().signal)).toBeUndefined()
  const held = Promise.withResolvers<void>()
  profile.gate.list = held.promise
  sharing.on = true
  // Resolves with the copy still held.
  await links.share(true)

  expect(link.signedIn(new AbortController().signal)).toBeInstanceOf(Promise)
  held.resolve()
  await settled(profile, other)
  await settled(profile, other)

  expect(other.size()).toBe(20)
  sharing.on = false
  await links.share(false)

  expect([profile.size(), other.size()]).toEqual([20, 0])
  expect(lines()).toEqual(["browser sign-in copy started", "browser sign-in copy finished"])
  links.dispose()
})

test("quitting ends every copy under way without waiting for one", async () => {
  const profile = createStore(many(3_000))
  const stores = [createStore(), createStore(), createStore()]
  const { links, lines } = linkedStores({ profile, sharing: true })
  stores.forEach((other) => links.link(other.session))

  while (!stores.every((other) => other.calls.sets)) await new Promise<void>((resolve) => setImmediate(resolve))
  // Synchronous: the app's quit goes on at once.
  links.dispose()
  await settled(profile, ...stores)

  expect(stores.every((other) => other.calls.sets < 100)).toBe(true)
  expect(lines().filter((line) => line === "browser sign-in copy cancelled")).toHaveLength(3)
  expect(links.partitions()).toEqual([])
})
