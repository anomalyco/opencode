import type { ImportedCookie } from "./cookie"

/** The two cookie stores a link keeps in step: the profile's and a remote server's partition. */
export type LinkSide = "profile" | "other"

/** One cookie's place in a store: its host as browsers store it (leading dot for a domain cookie), path and name. */
export function cookieKey(cookie: Pick<ImportedCookie, "host" | "path" | "name">) {
  return `${cookie.host}\n${cookie.path}\n${cookie.name}`
}

/** Whether two stores hold the same cookie for one key; both undefined means neither holds one. */
function sameCookie(a: ImportedCookie | undefined, b: ImportedCookie | undefined) {
  if (!a || !b) return a === b

  return (
    a.value === b.value &&
    a.secure === b.secure &&
    a.httpOnly === b.httpOnly &&
    a.sameSite === b.sameSite &&
    // Chromium keeps expiry in microseconds and reports seconds as a float.
    Math.round(a.expires ?? -1) === Math.round(b.expires ?? -1)
  )
}

/** What reconciling one key does: the value both stores hold afterwards, and the write that gets them there. */
export type CookieStep = {
  readonly base: ImportedCookie | undefined
  readonly write?: { readonly to: LinkSide; readonly cookie?: ImportedCookie }
}

/**
 * One key's next step, from what each store holds now and what both last agreed on (`base`). It compares state and
 * never predicts events, so a write that changes nothing, fails, or echoes back costs one comparison and loses no
 * change:
 * - Both stores hold the same: they agree; nothing to write.
 * - Only one store moved away from `base`: its value, or its removal, goes to the other store.
 * - Both moved (two writes raced): the store whose change is being handled (`changed`) wins.
 *
 * `write.cookie` undefined means remove the key from `write.to`. The new `base` is what both stores hold once the
 * write lands.
 */
export function reconcileCookie(input: {
  readonly base: ImportedCookie | undefined
  readonly profile: ImportedCookie | undefined
  readonly other: ImportedCookie | undefined
  readonly changed: LinkSide
}): CookieStep {
  if (sameCookie(input.profile, input.other)) return { base: input.profile }
  const profileMoved = !sameCookie(input.profile, input.base)
  const otherMoved = !sameCookie(input.other, input.base)
  const from = profileMoved && otherMoved ? input.changed : profileMoved ? "profile" : "other"
  const cookie = from === "profile" ? input.profile : input.other

  return { base: cookie, write: { to: from === "profile" ? "other" : "profile", cookie } }
}

/** A change one store reported for a cookie: which store, the cookie, and whether the store dropped it. */
export type CookieChange = { readonly side: LinkSide; readonly cookie: ImportedCookie; readonly removed: boolean }

/**
 * Whether a change needs no work: the store reports what both stores already agreed on. A write of the mirror's own
 * echoes back as such a change, as does a page that sets a cookie to the value it has, so neither costs a read.
 */
export function settledChange(base: ImportedCookie | undefined, change: CookieChange) {
  return change.removed ? !base : sameCookie(base, change.cookie)
}

/**
 * The address one store is asked for a cookie's key with, so it answers from that site's cookies and not from all of
 * them. Always `https`, which a secure and a plain cookie both match. Undefined for a key no address names, as a path
 * with a `?` or a space in it: the store is then asked for the key among all its cookies.
 */
export function cookieScope(cookie: Pick<ImportedCookie, "host" | "path">) {
  const host = cookie.host.replace(/^\./, "")
  const url = `https://${host.includes(":") && !host.startsWith("[") ? `[${host}]` : host}${cookie.path}`

  return URL.canParse(url) && new URL(url).pathname === cookie.path ? url : undefined
}

/** One write of the first copy: `cookie` goes into the store `to`. */
export type CopyWrite = { readonly to: LinkSide; readonly cookie: ImportedCookie }

/**
 * The first copy, from each store's whole list read once: every key goes through `reconcileCookie` with nothing
 * agreed yet, so a cookie only one store holds goes to the other, and where both hold different ones the profile's
 * wins. `base` is what both stores hold once every write lands. A store's first cookie for a key is the one that
 * counts, as when the store is asked for that key.
 */
export function planCopy(stores: Readonly<Record<LinkSide, readonly ImportedCookie[]>>) {
  const keyed = (cookies: readonly ImportedCookie[]) => {
    const found = new Map<string, ImportedCookie>()

    cookies.forEach((cookie) => {
      const key = cookieKey(cookie)

      if (!found.has(key)) found.set(key, cookie)
    })

    return found
  }

  const profile = keyed(stores.profile)
  const other = keyed(stores.other)
  const base = new Map<string, ImportedCookie>()
  const writes: CopyWrite[] = []

  new Set([...profile.keys(), ...other.keys()]).forEach((key) => {
    const step = reconcileCookie({ base: undefined, profile: profile.get(key), other: other.get(key), changed: profile.has(key) ? "profile" : "other" })

    if (step.base) base.set(key, step.base)

    if (step.write?.cookie) writes.push({ to: step.write.to, cookie: step.write.cookie })
  })

  return { base, writes }
}

/**
 * A mirror's life.
 * - `copying`: both stores are read once and brought together (`planCopy`). The changes the stores report meanwhile
 *   wait in `waiting`, in the order they came. `planned`: both lists are read, so what the stores will agree on is
 *   known and the copy's own writes, which echo back as changes, no longer wait.
 * - `following`: each change of either store is reconciled as it comes.
 * - `stopped`: nothing more is read or written.
 */
export type MirrorState =
  | { readonly status: "copying"; readonly planned: boolean; readonly waiting: readonly CookieChange[] }
  | { readonly status: "following" }
  | { readonly status: "stopped" }

export type MirrorEvent =
  | { readonly type: "changed"; readonly change: CookieChange }
  /** Both stores' lists are read and compared. */
  | { readonly type: "copy.planned" }
  /** The first copy ended. A copy that failed ends too: the stores are followed from where they are. */
  | { readonly type: "copy.ended" }
  | { readonly type: "stopped" }

/** Reconciles the key of `change` from what both stores hold now. */
export type MirrorEffect = { readonly type: "reconcile"; readonly change: CookieChange }

export type MirrorTransition = { readonly state: MirrorState; readonly effects: readonly MirrorEffect[] }

export const initialMirrorState: MirrorState = { status: "copying", planned: false, waiting: [] }

const FOLLOWING: MirrorState = { status: "following" }

const STOPPED: MirrorState = { status: "stopped" }

export function transitionMirror(state: MirrorState, event: MirrorEvent): MirrorTransition {
  if (state.status === "stopped") return { state, effects: [] }

  if (event.type === "stopped") return { state: STOPPED, effects: [] }

  if (event.type === "copy.ended") {
    if (state.status !== "copying") return { state, effects: [] }

    return { state: FOLLOWING, effects: state.waiting.map((change): MirrorEffect => ({ type: "reconcile", change })) }
  }

  if (event.type === "copy.planned") {
    if (state.status !== "copying" || state.planned) return { state, effects: [] }

    return { state: { ...state, planned: true }, effects: [] }
  }

  if (state.status === "copying") return { state: { ...state, waiting: [...state.waiting, event.change] }, effects: [] }

  return { state, effects: [{ type: "reconcile", change: event.change }] }
}

/**
 * Whether what both stores agreed on is known, so a change that reports exactly that is dropped unread
 * (`settledChange`). Before the first copy is planned nothing is agreed, and every change waits for it.
 */
export function agreementKnown(state: MirrorState) {
  return state.status === "following" || (state.status === "copying" && state.planned)
}

/** Whether the first copy is still under way. */
export function copyingStores(state: MirrorState) {
  return state.status === "copying"
}
