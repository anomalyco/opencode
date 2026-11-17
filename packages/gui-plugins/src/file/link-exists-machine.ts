/** How long a found path stays styled as a link before it is checked again. */
export const LINK_EXISTS_POSITIVE_TTL_MS = 60_000

/** How long a missing path stays plain code before it is checked again. */
export const LINK_EXISTS_NEGATIVE_TTL_MS = 5_000

/** How long one check may run before it counts as unanswered. */
export const LINK_EXISTS_TIMEOUT_MS = 15_000

/** The most paths one screen and server remember; the least recently checked go first. */
export const LINK_EXISTS_MAX_ENTRIES = 512

/** What is known about one link's path. */
export type LinkExistsEntry =
  /** The first check runs; callers wait for it. */
  | { readonly status: "checking"; readonly attempt: number; readonly deadline: number }
  /** A found path is checked again; it stays a link meanwhile. */
  | { readonly status: "revalidating"; readonly attempt: number; readonly deadline: number }
  /** A found path whose recheck did not answer: it stays a link, and the next read checks again. */
  | { readonly status: "stale" }
  | { readonly status: "settled"; readonly exists: boolean; readonly expiresAt: number }

/**
 * The link existence cache of one screen and server connection, oldest entry first. Each check takes the next attempt
 * number, so an answer whose attempt the entry no longer holds is stale; `issued` is the last one handed out.
 */
export type LinkExistsState = {
  readonly issued: number
  readonly entries: ReadonlyMap<string, LinkExistsEntry>
}

export type LinkExistsEvent =
  | { readonly type: "check.requested"; readonly key: string; readonly now: number }
  | {
      readonly type: "check.settled"
      readonly key: string
      readonly attempt: number
      readonly exists: boolean
      readonly now: number
    }
  /** The check failed, was cancelled because the user moved on, or timed out. */
  | { readonly type: "check.dropped"; readonly key: string; readonly attempt: number }

export type LinkExistsEffect =
  | { readonly type: "run-check"; readonly key: string; readonly attempt: number; readonly timeoutMs: number }
  /** Ends a check's controller and timeout; callers still waiting on it read false. */
  | { readonly type: "abort-check"; readonly attempt: number }

export type LinkExistsTransition = { readonly state: LinkExistsState; readonly effects: readonly LinkExistsEffect[] }

/** What a link reads now: a value, or the check to wait for. */
export type LinkExistsAnswer =
  | { readonly kind: "value"; readonly value: boolean }
  | { readonly kind: "pending"; readonly attempt: number }

const NONE: readonly LinkExistsEffect[] = []

const YES: LinkExistsAnswer = { kind: "value", value: true }

const NO: LinkExistsAnswer = { kind: "value", value: false }

export function createLinkExistsState(): LinkExistsState {
  return { issued: 0, entries: new Map() }
}

export function transitionLinkExists(state: LinkExistsState, event: LinkExistsEvent): LinkExistsTransition {
  const entry = state.entries.get(event.key)

  if (event.type === "check.requested") {
    if (entry?.status === "settled" && event.now < entry.expiresAt) return { state, effects: NONE }

    if ((entry?.status === "checking" || entry?.status === "revalidating") && event.now < entry.deadline)
      return { state, effects: NONE }

    const attempt = state.issued + 1
    const deadline = event.now + LINK_EXISTS_TIMEOUT_MS

    // Revalidate known paths without bringing back their plain-code flash. Expired negatives await a fresh check.
    const known =
      entry?.status === "stale" || entry?.status === "revalidating" || (entry?.status === "settled" && entry.exists)

    const entries = new Map(state.entries)
    entries.delete(event.key)
    entries.set(
      event.key,
      known ? { status: "revalidating", attempt, deadline } : { status: "checking", attempt, deadline },
    )
    const evicted = [...entries.keys()].slice(0, Math.max(0, entries.size - LINK_EXISTS_MAX_ENTRIES))

    const aborts = [entry, ...evicted.map((key) => entries.get(key))].flatMap((item): LinkExistsEffect[] =>
      item?.status === "checking" || item?.status === "revalidating"
        ? [{ type: "abort-check", attempt: item.attempt }]
        : [],
    )

    evicted.forEach((key) => entries.delete(key))

    return {
      state: { issued: attempt, entries },
      effects: [...aborts, { type: "run-check", key: event.key, attempt, timeoutMs: LINK_EXISTS_TIMEOUT_MS }],
    }
  }

  if ((entry?.status !== "checking" && entry?.status !== "revalidating") || entry.attempt !== event.attempt)
    return { state, effects: NONE }

  const entries = new Map(state.entries)
  const effects: readonly LinkExistsEffect[] = [{ type: "abort-check", attempt: entry.attempt }]

  if (event.type === "check.settled") {
    entries.set(event.key, {
      status: "settled",
      exists: event.exists,
      expiresAt: event.now + (event.exists ? LINK_EXISTS_POSITIVE_TTL_MS : LINK_EXISTS_NEGATIVE_TTL_MS),
    })

    return { state: { issued: state.issued, entries }, effects }
  }

  // An unanswered first check is retryable, not a cached negative.
  if (entry.status === "checking") entries.delete(event.key)
  else entries.set(event.key, { status: "stale" })

  return { state: { issued: state.issued, entries }, effects }
}

export function linkExistsAnswer(state: LinkExistsState, key: string): LinkExistsAnswer {
  const entry = state.entries.get(key)

  if (!entry) return NO

  if (entry.status === "checking") return { kind: "pending", attempt: entry.attempt }

  if (entry.status === "settled") return entry.exists ? YES : NO

  return YES
}
