import type { ImportedCookie } from "./cookie"

/** The two cookie stores a link keeps in step: the profile's and a remote server's partition. */
export type LinkSide = "profile" | "other"

/** One cookie's place in a store: its host as browsers store it (leading dot for a domain cookie), path and name. */
export function cookieKey(cookie: Pick<ImportedCookie, "host" | "path" | "name">) {
  return `${cookie.host}\n${cookie.path}\n${cookie.name}`
}

/** Whether two stores hold the same cookie for one key; both undefined means neither holds one. */
export function sameCookie(a: ImportedCookie | undefined, b: ImportedCookie | undefined) {
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
}): { readonly base: ImportedCookie | undefined; readonly write?: { readonly to: LinkSide; readonly cookie?: ImportedCookie } } {
  if (sameCookie(input.profile, input.other)) return { base: input.profile }
  const profileMoved = !sameCookie(input.profile, input.base)
  const otherMoved = !sameCookie(input.other, input.base)
  const from = profileMoved && otherMoved ? input.changed : profileMoved ? "profile" : "other"
  const cookie = from === "profile" ? input.profile : input.other

  return { base: cookie, write: { to: from === "profile" ? "other" : "profile", cookie } }
}
