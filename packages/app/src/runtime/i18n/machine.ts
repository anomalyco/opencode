import type { DesktopNativeLocale } from "./desktop-native"

/** A dynamic `import()` can hang on a stalled network; past this the switch gives up and keeps the current language. */
export const LOCALE_LOAD_TIMEOUT_MS = 10_000

/**
 * `locale` and `dictionary` are always the committed pair every reader shows. A load keeps them until its dictionary
 * arrives, so the strings, plural rules, `lang`/`dir` and the stored choice switch together, never one ahead.
 */
export type LanguageState<Dict> =
  | {
      readonly status: "ready"
      readonly issued: number
      readonly locale: DesktopNativeLocale
      readonly dictionary: Dict
    }
  | {
      readonly status: "loading"
      readonly issued: number
      readonly attempt: number
      readonly locale: DesktopNativeLocale
      readonly dictionary: Dict
      /** The locale whose dictionary is loading. */
      readonly target: DesktopNativeLocale
      /** The user chose it: success stores the choice and failure tells them. A synced load does neither. */
      readonly persist: boolean
    }
  | { readonly status: "disposed"; readonly locale: DesktopNativeLocale; readonly dictionary: Dict }

export type LanguageEvent<Dict> =
  /** The user picked a language. `cached` is its dictionary when it already loaded. */
  | { readonly type: "locale.requested"; readonly locale: DesktopNativeLocale; readonly cached: Dict | undefined }
  /** The stored choice changed under us: storage hydrated, or another window picked a language. */
  | { readonly type: "locale.synced"; readonly locale: DesktopNativeLocale; readonly cached: Dict | undefined }
  | { readonly type: "load.succeeded"; readonly attempt: number; readonly dictionary: Dict }
  | { readonly type: "load.failed"; readonly attempt: number }
  | { readonly type: "load.timed-out"; readonly attempt: number }
  | { readonly type: "disposed" }

export type LanguageEffect =
  | { readonly type: "load"; readonly attempt: number; readonly locale: DesktopNativeLocale }
  | { readonly type: "timer.start"; readonly attempt: number; readonly timeoutMs: number }
  | { readonly type: "timer.stop" }
  /** Store the committed choice. */
  | { readonly type: "persist"; readonly locale: DesktopNativeLocale }
  | { readonly type: "notify.error"; readonly locale: DesktopNativeLocale }

export type LanguageTransition<Dict> = {
  readonly state: LanguageState<Dict>
  readonly effects: readonly LanguageEffect[]
}

/** Starts on `initial` when its dictionary is cached, else on the fallback while `initial` loads. */
export function createLanguageState<Dict>(input: {
  readonly initial: DesktopNativeLocale
  readonly cached: Dict | undefined
  readonly fallbackLocale: DesktopNativeLocale
  readonly fallbackDictionary: Dict
}): LanguageTransition<Dict> {
  if (input.cached !== undefined)
    return { state: { status: "ready", issued: 0, locale: input.initial, dictionary: input.cached }, effects: [] }

  return load(
    { status: "ready", issued: 0, locale: input.fallbackLocale, dictionary: input.fallbackDictionary },
    input.initial,
    false,
  )
}

export function transitionLanguage<Dict>(
  state: LanguageState<Dict>,
  event: LanguageEvent<Dict>,
): LanguageTransition<Dict> {
  if (state.status === "disposed") return { state, effects: [] }

  const stop = state.status === "loading" ? [STOP] : []

  if (event.type === "disposed")
    return { state: { status: "disposed", locale: state.locale, dictionary: state.dictionary }, effects: stop }

  if (event.type === "locale.requested") {
    const persist = { type: "persist", locale: event.locale } as const

    // The stored choice can differ from the committed one after a failed load at startup, so it is written again.
    if (state.status === "ready" && state.locale === event.locale) return { state, effects: [persist] }

    if (event.cached !== undefined)
      return { state: ready(state, event.locale, event.cached), effects: [...stop, persist] }

    if (state.status === "loading" && state.target === event.locale)
      return { state: state.persist ? state : { ...state, persist: true }, effects: [] }

    return load(state, event.locale, true)
  }

  if (event.type === "locale.synced") {
    // The user's own pick wins over the stored value it is about to replace.
    if (state.status === "loading" && state.persist) return { state, effects: [] }

    if (state.status === "ready" && state.locale === event.locale) return { state, effects: [] }

    if (event.cached !== undefined) return { state: ready(state, event.locale, event.cached), effects: stop }

    if (state.status === "loading" && state.target === event.locale) return { state, effects: [] }

    return load(state, event.locale, false)
  }

  if (state.status !== "loading" || event.attempt !== state.attempt) return { state, effects: [] }

  if (event.type === "load.succeeded")
    return {
      state: ready(state, state.target, event.dictionary),
      effects: state.persist ? [STOP, { type: "persist", locale: state.target }] : [STOP],
    }

  return {
    state: ready(state, state.locale, state.dictionary),
    effects: state.persist ? [STOP, { type: "notify.error", locale: state.target }] : [STOP],
  }
}

export function selectLocale<Dict>(state: LanguageState<Dict>) {
  return state.locale
}

export function selectDictionary<Dict>(state: LanguageState<Dict>) {
  return state.dictionary
}

const STOP = { type: "timer.stop" } as const

function ready<Dict>(
  state: Exclude<LanguageState<Dict>, { status: "disposed" }>,
  locale: DesktopNativeLocale,
  dictionary: Dict,
): LanguageState<Dict> {
  return { status: "ready", issued: state.issued, locale, dictionary }
}

function load<Dict>(
  state: Exclude<LanguageState<Dict>, { status: "disposed" }>,
  target: DesktopNativeLocale,
  persist: boolean,
): LanguageTransition<Dict> {
  const attempt = state.issued + 1

  return {
    state: {
      status: "loading",
      issued: attempt,
      attempt,
      locale: state.locale,
      dictionary: state.dictionary,
      target,
      persist,
    },
    effects: [
      ...(state.status === "loading" ? [STOP] : []),
      { type: "load", attempt, locale: target },
      { type: "timer.start", attempt, timeoutMs: LOCALE_LOAD_TIMEOUT_MS },
    ],
  }
}
