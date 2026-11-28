import { loopback } from "../address"
import { cookieDetails, cookieURL, fromElectron, PROBE_COOKIE, type ImportedCookie } from "./cookie"
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
  type MirrorState,
} from "./link-machine"

export type CookieMirror = ReturnType<typeof createCookieMirror>

type ChangeListener = (event: Electron.Event, cookie: Electron.Cookie, cause: string, removed: boolean) => void

/** What the mirror uses of an Electron session: its cookie store. */
export type MirroredSession = {
  readonly cookies: {
    get(filter: Electron.CookiesGetFilter): Promise<Electron.Cookie[]>
    set(details: Electron.CookiesSetDetails): Promise<void>
    remove(url: string, name: string): Promise<void>
    on(event: "changed", listener: ChangeListener): void
    off(event: "changed", listener: ChangeListener): void
  }
}

/** Writes the desktop log. Each field is a number or a string, and none names a cookie or a site. */
export type MirrorLog = (level: "info" | "warn", message: string, data: Readonly<Record<string, number | string>>) => void

/** The mirror's current state; only its `dispatch` replaces it. */
type MirrorMachine = { state: MirrorState }

/** How many cookies are written, or keys reconciled, at a time: the main process and the network service serve every window. */
const WRITE_BATCH = 16

/** Lets the main process's other work run. */
const turn = () => new Promise<void>((resolve) => setImmediate(resolve))

/**
 * Whether a cookie crosses between the stores. The probe never does. Nor does a loopback host's: each store's
 * localhost is its own machine, so a remote server's localhost:3000 is not the one on the user's computer.
 */
const shared = (cookie: Electron.Cookie) => {
  const host = cookie.domain?.replace(/^\./, "") ?? ""

  return host !== PROBE_COOKIE.host && !loopback(host)
}

/**
 * Keeps a remote server's partition (`other`) and the profile holding the same cookies, both ways, while the user
 * shares sign-ins with remote servers.
 *
 * It starts with one copy: each store's whole list is read once, the two are compared in memory (`planCopy`), and
 * only the differences are written, a few at a time. After that every change of either store reconciles its key from
 * both stores' current cookies (see `reconcileCookie`), one key at a time. A store is then asked for one site's
 * cookies, never for all of them, and a change that reports what both stores already agreed on, as a write's echo
 * does, costs no read.
 */
export function createCookieMirror(input: { profile: MirroredSession; other: MirroredSession; log: MirrorLog }) {
  const sessions: Record<LinkSide, MirroredSession> = { profile: input.profile, other: input.other }
  // What both stores last agreed on, by key, and each key's reconcile in flight.
  const base = new Map<string, ImportedCookie>()
  const queues = new Map<string, Promise<void>>()
  const machine: MirrorMachine = { state: initialMirrorState }
  // Pairs this mirror's lines in the log.
  const copy = crypto.randomUUID().slice(0, 8)
  const began = performance.now()
  const ms = () => Math.round(performance.now() - began)
  const stopped = () => machine.state.status === "stopped"
  // Changes that could not be reconciled since the mirror started; the log hears of the 1st, the 10th, the 100th.
  const failures = { count: 0 }

  const read = async (side: LinkSide, cookie: ImportedCookie) => {
    const url = cookieScope(cookie)

    // With an address the store answers from that site's cookies. Without one it fetches every cookie it holds.
    const found = await sessions[side].cookies.get(
      url ? { url, name: cookie.name } : { domain: cookie.host.replace(/^\./, ""), path: cookie.path, name: cookie.name },
    )

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

  // At most `WRITE_BATCH` keys are reconciled at a time, so a burst of changes, as an import's, takes its turn. A
  // finished reconcile hands its place to the one that waited longest.
  const places = { taken: 0, waiting: new Array<() => void>() }

  const place = () => {
    if (places.taken >= WRITE_BATCH) return new Promise<void>((resolve) => places.waiting.push(resolve))
    places.taken += 1

    return Promise.resolve()
  }

  const release = () => {
    const next = places.waiting.shift()

    if (next) return next()
    places.taken -= 1
  }

  const reconcile = async (change: CookieChange) => {
    const key = cookieKey(change.cookie)

    if (stopped() || settledChange(base.get(key), change)) return
    const [profile, other] = await Promise.all([read("profile", change.cookie), read("other", change.cookie)])

    if (stopped()) return
    const step = reconcileCookie({ base: base.get(key), profile, other, changed: change.side })

    if (step.base) base.set(key, step.base)

    if (!step.base) base.delete(key)

    if (step.write) await write(step.write.to, step.write.cookie, step.write.to === "profile" ? profile : other)
  }

  const sync = (change: CookieChange) => {
    const key = cookieKey(change.cookie)

    const next = (queues.get(key) ?? Promise.resolve())
      .then(place)
      .then(() => reconcile(change).finally(release))
      .catch((cause: unknown) => {
        failures.count += 1

        if (/^10*$/.test(String(failures.count)))
          input.log("warn", "browser sign-in change was not copied", { copy, failures: failures.count, cause: String(cause) })
      })

    queues.set(key, next)
    void next.then(() => {
      if (queues.get(key) === next) queues.delete(key)
    })
  }

  const dispatch = (event: MirrorEvent) => {
    const next = transitionMirror(machine.state, event)
    machine.state = next.state
    next.effects.forEach((effect) => sync(effect.change))
  }

  const listener =
    (side: LinkSide): ChangeListener =>
    (_event, cookie, cause, removed) => {
      // An overwrite removes the old value just before it inserts the new one, whose event follows.
      if (cause === "overwrite" || cause === "expired-overwrite") return

      if (!shared(cookie)) return
      const change: CookieChange = { side, cookie: fromElectron(cookie), removed }

      // The echo of one of the mirror's own writes, or a cookie set to the value it has: nothing to read or write.
      if (agreementKnown(machine.state) && settledChange(base.get(cookieKey(change.cookie)), change)) return
      dispatch({ type: "changed", change })
    }

  const toOther = listener("profile")
  const toProfile = listener("other")
  // Listening first, so a change made while the stores are first compared is reconciled after it.
  input.profile.cookies.on("changed", toOther)
  input.other.cookies.on("changed", toProfile)

  const list = async (side: LinkSide) =>
    (await sessions[side].cookies.get({})).filter(shared).map(fromElectron)

  const copyStores = async () => {
    input.log("info", "browser sign-in copy started", { copy })
    const [profile, other] = await Promise.all([list("profile"), list("other")])

    if (stopped()) return input.log("info", "browser sign-in copy cancelled", { copy, written: 0, ms: ms() })
    const plan = planCopy({ profile, other })
    // A cookie a store refuses does not end the copy: they are counted, and the log gets the first one's reason.
    const refused = { count: 0, cause: "" }
    plan.base.forEach((cookie, key) => base.set(key, cookie))
    dispatch({ type: "copy.planned" })

    // A few writes at a time, and the main process's other work in between. Stopping the mirror ends the copy at the
    // next batch.
    for (let at = 0; at < plan.writes.length; at += WRITE_BATCH) {
      await Promise.all(
        plan.writes.slice(at, at + WRITE_BATCH).map((item) =>
          write(item.to, item.cookie, undefined).catch((cause: unknown) => {
            refused.count += 1
            refused.cause ||= String(cause)
          }),
        ),
      )
      await turn()

      if (stopped())
        return input.log("info", "browser sign-in copy cancelled", { copy, written: Math.min(at + WRITE_BATCH, plan.writes.length), ms: ms() })
    }

    const counts = {
      copy,
      profile: profile.length,
      remote: other.length,
      toRemote: plan.writes.filter((item) => item.to === "other").length,
      toProfile: plan.writes.filter((item) => item.to === "profile").length,
      refused: refused.count,
      ms: ms(),
    }

    if (refused.count) return input.log("warn", "browser sign-in copy finished", { ...counts, cause: refused.cause })
    input.log("info", "browser sign-in copy finished", counts)
  }

  // The copy always ends: finished, cancelled, or failed, which the log says. The stores are then followed from where
  // they are, and the changes that waited for the copy are reconciled.
  const started = copyStores()
    .catch((cause: unknown) => input.log("warn", "browser sign-in copy failed", { copy, cause: String(cause), ms: ms() }))
    .then(() => dispatch({ type: "copy.ended" }))

  return {
    /** Resolves once the first copy ended: it finished, failed or was stopped. Never rejects. */
    started,
    /** Whether the first copy is still under way, so a page that needs the sign-ins waits for `started`. */
    copying: () => copyingStores(machine.state),
    /**
     * Stops mirroring, and the copy when it is still under way. With `forget`, the cookies the stores shared are
     * removed from the remote partition, as when the user stops sharing sign-ins; the profile keeps its own.
     */
    async stop(forget: boolean) {
      dispatch({ type: "stopped" })
      input.profile.cookies.off("changed", toOther)
      input.other.cookies.off("changed", toProfile)

      if (!forget) return
      await started
      await Promise.all(queues.values())
      const shared = [...base.values()]
      const kept = { count: 0, cause: "" }

      for (let at = 0; at < shared.length; at += WRITE_BATCH) {
        await Promise.all(
          shared.slice(at, at + WRITE_BATCH).map((cookie) =>
            input.other.cookies.remove(cookieURL(cookie), cookie.name).catch((cause: unknown) => {
              kept.count += 1
              kept.cause ||= String(cause)
            }),
          ),
        )
        await turn()
      }

      base.clear()

      if (kept.count) input.log("warn", "browser shared sign-ins were not removed", { copy, kept: kept.count, cause: kept.cause })
    },
  }
}

/**
 * The remote servers' partitions, each with its mirror of the profile's cookies while the user shares sign-ins with
 * remote servers (`sharing`). No call here waits for a mirror's first copy: it runs on its own, and only a page that
 * needs the sign-ins waits for it (`signedIn`).
 */
export function createSignInLinks<Partition extends MirroredSession>(input: {
  profile: MirroredSession
  sharing: () => boolean
  log: MirrorLog
}) {
  const links = new Map<Partition, CookieMirror | undefined>()

  const mirror = (other: Partition) => {
    if (links.get(other) || !links.has(other)) return
    links.set(other, createCookieMirror({ profile: input.profile, other, log: input.log }))
  }

  const unmirror = async (other: Partition, forget: boolean) => {
    const current = links.get(other)

    if (!current) return

    if (links.has(other)) links.set(other, undefined)
    await current.stop(forget)
  }

  return {
    /** Every registered partition, mirrored or not. */
    partitions: () => [...links.keys()],
    /**
     * Starts every partition's mirror, or stops it. Stopping removes the shared cookies from the partitions and
     * resolves once they are gone; starting resolves at once.
     */
    async share(enabled: boolean) {
      await Promise.all([...links.keys()].map((other) => (enabled ? mirror(other) : unmirror(other, true))))
    },
    /** Registers a partition, and starts its mirror while sign-ins are shared. */
    link(other: Partition) {
      links.set(other, undefined)

      if (input.sharing()) mirror(other)

      return {
        /**
         * What a page of the partition waits for before it loads, so it opens signed in: the first copy of the
         * sign-ins, while one is under way. Undefined when there is nothing to wait for. Rejects with the signal's
         * reason once `signal` aborts, as when the person stops the load or the pane closes.
         */
        signedIn(signal: AbortSignal) {
          const current = links.get(other)

          if (!current?.copying()) return undefined
          signal.throwIfAborted()
          const canceled = Promise.withResolvers<never>()
          const close = () => canceled.reject(signal.reason)
          signal.addEventListener("abort", close, { once: true })

          return Promise.race([current.started, canceled.promise]).finally(() => signal.removeEventListener("abort", close))
        },
        /** Ends the partition's mirror, and its first copy when that is still under way. The partition keeps its cookies. */
        unlink() {
          void unmirror(other, false)
          links.delete(other)
        },
      }
    },
    /** Ends every mirror, as when the app quits: nothing waits for a copy. */
    dispose() {
      links.forEach((_mirror, other) => void unmirror(other, false))
      links.clear()
    },
  }
}
