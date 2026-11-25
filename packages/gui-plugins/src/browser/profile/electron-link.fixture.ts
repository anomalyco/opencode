import electron, { type Session } from "electron"
import { createCookieMirror, type MirroredSession } from "./link"

// The Electron main process of `electron-link.test.ts`, bundled and run by the pinned Electron. It mirrors two
// in-memory sessions' cookie stores, the profile's and a remote server's partition's, with made-up cookies of every
// kind a key can be: a domain cookie, a host-only one, a plain-http one, one on a path, one that ends with the
// session, and the same name twice under one host. It counts what each store is asked, makes a change in each store
// the way a page does, stops sharing, and prints the stores at each step as one JSON line.

type Calls = { lists: number; sites: number; keys: number; sets: number; removes: number }

/** The session's cookie store, counting what it is asked: its whole list, one site's cookies, or one cookie by key. */
function counted(session: Session) {
  const calls: Calls = { lists: 0, sites: 0, keys: 0, sets: 0, removes: 0 }

  const store: MirroredSession = {
    cookies: {
      get(filter) {
        if (filter.url) calls.sites += 1

        if (!filter.url && filter.domain) calls.keys += 1

        if (!filter.url && !filter.domain) calls.lists += 1

        return session.cookies.get(filter)
      },
      set(details) {
        calls.sets += 1

        return session.cookies.set(details)
      },
      remove(url, name) {
        calls.removes += 1

        return session.cookies.remove(url, name)
      },
      on: (event, listener) => void session.cookies.on(event, listener),
      off: (event, listener) => void session.cookies.off(event, listener),
    },
  }

  return { store, calls }
}

void electron.app.whenReady().then(async () => {
  const profile = electron.session.fromPartition("link-fixture-profile")
  const other = electron.session.fromPartition("link-fixture-remote")
  // Chromium keeps an expiry in microseconds and caps it at 400 days from now, so the lines below say only whether a
  // cookie ends with the session, and `expiries` whether both stores hold the same second for every cookie.
  const expirationDate = Math.floor(Date.now() / 1000) + 86_400
  const logged: string[] = []

  // One line per cookie: where it is, what it holds, and the attributes a copy must keep.
  const held = async (session: Session) =>
    (await session.cookies.get({}))
      .map((cookie) =>
        [
          `${cookie.domain}${cookie.path} ${cookie.name}=${cookie.value}`,
          cookie.secure ? "secure" : "plain",
          cookie.httpOnly ? "httpOnly" : "script",
          cookie.session ? "session" : "persistent",
          cookie.sameSite,
        ].join(" "),
      )
      .toSorted()

  const both = async () => ({ profile: await held(profile), remote: await held(other) })

  const expiries = async (session: Session) =>
    (await session.cookies.get({})).map((cookie) => `${cookie.domain}${cookie.path} ${cookie.name} ${Math.round(cookie.expirationDate ?? 0)}`).toSorted().join("\n")

  // Until both stores hold the same cookies and `check` holds, for at most five seconds: a copy that never lands
  // fails the test's comparison, not the fixture.
  const agreed = async (check: (cookies: string[]) => boolean) => {
    const deadline = Date.now() + 5_000

    while (Date.now() < deadline) {
      const now = await both()

      if (now.profile.join("\n") === now.remote.join("\n") && check(now.profile)) break
      await new Promise<void>((resolve) => setTimeout(resolve, 20))
    }

    // The writes' echoes arrive after them.
    await new Promise<void>((resolve) => setTimeout(resolve, 200))
  }

  await Promise.all([
    profile.cookies.set({ url: "https://example.test/", domain: ".example.test", name: "domain", value: "profile", secure: true, httpOnly: true, sameSite: "lax", expirationDate }),
    profile.cookies.set({ url: "https://www.example.test/", name: "host", value: "same", secure: true, sameSite: "strict", expirationDate }),
    profile.cookies.set({ url: "http://plain.test/", name: "plain", value: "p", expirationDate }),
    profile.cookies.set({ url: "https://example.test/app", domain: ".example.test", path: "/app", name: "domain", value: "on-a-path", secure: true, expirationDate }),
    profile.cookies.set({ url: "https://example.test/", name: "ends", value: "with-the-session", secure: true }),
    // The same name on the domain and on its host alone: two keys.
    profile.cookies.set({ url: "https://example.test/", domain: ".example.test", name: "twin", value: "of-the-domain", secure: true, expirationDate }),
    profile.cookies.set({ url: "https://example.test/", name: "twin", value: "of-the-host", secure: true, expirationDate }),
    // Shared already.
    other.cookies.set({ url: "https://www.example.test/", name: "host", value: "same", secure: true, sameSite: "strict", expirationDate }),
    // Both hold one: the profile's wins.
    other.cookies.set({ url: "https://example.test/", domain: ".example.test", name: "domain", value: "remote", secure: true, httpOnly: true, sameSite: "lax", expirationDate }),
    // Only the partition holds it: it goes to the profile.
    other.cookies.set({ url: "https://remote.test/", domain: ".remote.test", name: "remote", value: "r", secure: true, expirationDate }),
  ])

  const before = await both()
  const stores = { profile: counted(profile), remote: counted(other) }

  const mirror = createCookieMirror({
    profile: stores.profile.store,
    other: stores.remote.store,
    log: (level, message, data) => void logged.push(`${level} ${message} ${Object.entries(data).flatMap(([key, value]) => (key === "copy" || key === "ms" ? [] : [`${key}=${value}`])).join(" ")}`.trim()),
  })

  await mirror.started
  await agreed(() => true)
  const copied = { ...(await both()), calls: { profile: { ...stores.profile.calls }, remote: { ...stores.remote.calls } } }
  const sameExpiries = (await expiries(profile)) === (await expiries(other))

  // A page of the profile signs in again; a page of the remote server signs out of one site, and in to a new one on
  // a path; and the remote server's page changes one of the twins.
  await profile.cookies.set({ url: "https://www.example.test/", name: "host", value: "signed-in-again", secure: true, sameSite: "strict", expirationDate })
  await agreed((cookies) => cookies.some((line) => line.includes("host=signed-in-again")))
  await other.cookies.remove("http://plain.test/", "plain")
  await agreed((cookies) => !cookies.some((line) => line.includes("plain=")))
  await other.cookies.set({ url: "https://new.test/deep/er", path: "/deep/er", name: "fresh", value: "f", secure: true, httpOnly: true, expirationDate })
  await agreed((cookies) => cookies.some((line) => line.includes("fresh=f")))
  await other.cookies.set({ url: "https://example.test/", name: "twin", value: "changed-on-the-host", secure: true, expirationDate })
  await agreed((cookies) => cookies.some((line) => line.includes("twin=changed-on-the-host")))
  const followed = { ...(await both()), calls: { profile: { ...stores.profile.calls }, remote: { ...stores.remote.calls } } }

  // The user stops sharing sign-ins: the partition loses what the stores shared, the profile keeps it.
  await mirror.stop(true)
  const stopped = await both()

  process.stdout.write(`${JSON.stringify({ before, copied, sameExpiries, followed, stopped, logged })}\n`)
  electron.app.quit()
})
