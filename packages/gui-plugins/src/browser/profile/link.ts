import type { Session } from "electron"
import { cookieDetails, cookieURL, fromElectron, PROBE_COOKIE, type ImportedCookie } from "./cookie"
import { cookieKey, reconcileCookie, type LinkSide } from "./link-machine"

export type CookieMirror = ReturnType<typeof createCookieMirror>

/**
 * Keeps a remote server's partition (`other`) and the profile holding the same cookies, both ways, while the user
 * shares sign-ins with remote servers. Every change of either store reconciles its key from both stores' current
 * cookies (see `reconcileCookie`), one key at a time, so writes that echo back stop at the first comparison.
 */
export function createCookieMirror(input: { profile: Session; other: Session }) {
  const sessions: Record<LinkSide, Session> = { profile: input.profile, other: input.other }
  // What both stores last agreed on, by key, and each key's reconcile in flight.
  const base = new Map<string, ImportedCookie>()
  const queues = new Map<string, Promise<void>>()
  const state = { stopped: false }

  const read = async (side: LinkSide, cookie: ImportedCookie) => {
    const found = await sessions[side].cookies.get({
      domain: cookie.host.replace(/^\./, ""),
      path: cookie.path,
      name: cookie.name,
    })

    const match = found.find((item) => (item.domain ?? "") === cookie.host && (item.path ?? "/") === cookie.path)

    return match ? fromElectron(match) : undefined
  }

  const write = (side: LinkSide, cookie: ImportedCookie | undefined, current: ImportedCookie | undefined) => {
    if (cookie) {
      const details = cookieDetails(cookie)

      return details ? sessions[side].cookies.set(details) : Promise.resolve()
    }

    return current ? sessions[side].cookies.remove(cookieURL(current), current.name) : Promise.resolve()
  }

  const sync = (cookie: ImportedCookie, changed: LinkSide) => {
    const key = cookieKey(cookie)

    const next = (queues.get(key) ?? Promise.resolve())
      .then(async () => {
        if (state.stopped) return
        const [profile, other] = await Promise.all([read("profile", cookie), read("other", cookie)])

        if (state.stopped) return
        const step = reconcileCookie({ base: base.get(key), profile, other, changed })

        if (step.base) base.set(key, step.base)

        if (!step.base) base.delete(key)

        if (step.write)
          await write(step.write.to, step.write.cookie, step.write.to === "profile" ? profile : other)
      })
      .catch(() => undefined)

    queues.set(key, next)
    void next.then(() => {
      if (queues.get(key) === next) queues.delete(key)
    })

    return next
  }

  const listener =
    (side: LinkSide) => (_event: Electron.Event, cookie: Electron.Cookie, cause: string) => {
      // An overwrite removes the old value just before it inserts the new one, whose event follows.
      if (cause === "overwrite" || cause === "expired-overwrite") return

      if (cookie.domain?.replace(/^\./, "") === PROBE_COOKIE.host) return
      void sync(fromElectron(cookie), side)
    }

  const toOther = listener("profile")
  const toProfile = listener("other")
  // Listening first, so a change made while the stores are first compared is reconciled after it.
  input.profile.cookies.on("changed", toOther)
  input.other.cookies.on("changed", toProfile)

  const started = Promise.all(
    (["profile", "other"] as const).map(async (side) => {
      const cookies = await sessions[side].cookies.get({}).catch(() => [])

      await Promise.all(
        cookies.flatMap((cookie) =>
          cookie.domain?.replace(/^\./, "") === PROBE_COOKIE.host ? [] : [sync(fromElectron(cookie), side)],
        ),
      )
    }),
  )

  return {
    /** Resolves once every cookie either store held at the start is reconciled. */
    started,
    /**
     * Stops mirroring. With `forget`, the cookies the stores shared are removed from the remote partition, as when
     * the user stops sharing sign-ins; the profile keeps its own.
     */
    async stop(forget: boolean) {
      state.stopped = true
      input.profile.cookies.off("changed", toOther)
      input.other.cookies.off("changed", toProfile)

      if (!forget) return
      await Promise.all(queues.values())
      await Promise.all(
        [...base.values()].map((cookie) =>
          input.other.cookies.remove(cookieURL(cookie), cookie.name).catch(() => undefined),
        ),
      )
      base.clear()
    },
  }
}
