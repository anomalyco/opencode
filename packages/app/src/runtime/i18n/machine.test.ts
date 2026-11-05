import { describe, expect, test } from "bun:test"
import {
  createLanguageState,
  LOCALE_LOAD_TIMEOUT_MS,
  selectDictionary,
  selectLocale,
  transitionLanguage,
  type LanguageEffect,
  type LanguageEvent,
  type LanguageState,
} from "./machine"

type Dict = { readonly hello: string }

const en: Dict = { hello: "Hello" }
const de: Dict = { hello: "Hallo" }
const ar: Dict = { hello: "مرحبا" }

const readyOn = (locale: "en" | "de", dictionary: Dict) =>
  createLanguageState({ initial: locale, cached: dictionary, fallbackLocale: "en", fallbackDictionary: en }).state

function replay(state: LanguageState<Dict>, events: readonly LanguageEvent<Dict>[]) {
  return events.reduce<{ state: LanguageState<Dict>; effects: LanguageEffect[] }>(
    (result, event) => {
      const next = transitionLanguage(result.state, event)

      return { state: next.state, effects: [...result.effects, ...next.effects] }
    },
    { state, effects: [] },
  )
}

const shown = (state: LanguageState<Dict>) => ({ locale: selectLocale(state), dictionary: selectDictionary(state) })

describe("language machine", () => {
  test("a failed chunk for a picked language keeps the current one and says so", () => {
    const loading = transitionLanguage(readyOn("en", en), { type: "locale.requested", locale: "ar", cached: undefined })

    expect(loading.effects).toEqual([
      { type: "load", attempt: 1, locale: "ar" },
      { type: "timer.start", attempt: 1, timeoutMs: LOCALE_LOAD_TIMEOUT_MS },
    ])
    expect(shown(loading.state)).toEqual({ locale: "en", dictionary: en })

    const failed = transitionLanguage(loading.state, { type: "load.failed", attempt: 1 })

    expect(failed.state).toEqual({ status: "ready", issued: 1, locale: "en", dictionary: en })
    expect(failed.effects).toEqual([{ type: "timer.stop" }, { type: "notify.error", locale: "ar" }])
  })

  test("a stored language whose chunk fails at startup falls back to English quietly", () => {
    const boot = createLanguageState<Dict>({
      initial: "ja",
      cached: undefined,
      fallbackLocale: "en",
      fallbackDictionary: en,
    })

    expect(shown(boot.state)).toEqual({ locale: "en", dictionary: en })
    expect(boot.effects[0]).toEqual({ type: "load", attempt: 1, locale: "ja" })

    const failed = transitionLanguage(boot.state, { type: "load.failed", attempt: 1 })

    expect(shown(failed.state)).toEqual({ locale: "en", dictionary: en })
    expect(failed.effects).toEqual([{ type: "timer.stop" }])
  })

  test("a switch keeps the previous language and direction until the new dictionary lands, then commits both", () => {
    const loading = transitionLanguage(readyOn("de", de), { type: "locale.requested", locale: "ar", cached: undefined })

    expect(shown(loading.state)).toEqual({ locale: "de", dictionary: de })

    const loaded = transitionLanguage(loading.state, { type: "load.succeeded", attempt: 1, dictionary: ar })

    expect(shown(loaded.state)).toEqual({ locale: "ar", dictionary: ar })
    expect(loaded.effects).toEqual([{ type: "timer.stop" }, { type: "persist", locale: "ar" }])
  })

  test("a chunk that never answers times out back to the committed language", () => {
    const result = replay(readyOn("en", en), [
      { type: "locale.requested", locale: "ar", cached: undefined },
      { type: "load.timed-out", attempt: 1 },
    ])

    expect(shown(result.state)).toEqual({ locale: "en", dictionary: en })
    expect(result.effects.slice(-2)).toEqual([{ type: "timer.stop" }, { type: "notify.error", locale: "ar" }])
  })

  test.each([
    { name: "another uncached language", next: { locale: "fr", cached: undefined }, shows: "en" },
    { name: "a cached language", next: { locale: "de", cached: de }, shows: "de" },
  ] as const)("picking $name ignores the earlier load's late result", (input) => {
    const switched = replay(readyOn("en", en), [
      { type: "locale.requested", locale: "ar", cached: undefined },
      { type: "locale.requested", ...input.next },
    ])

    expect(switched.effects).toContainEqual({ type: "timer.stop" })

    const late = transitionLanguage(switched.state, { type: "load.succeeded", attempt: 1, dictionary: ar })

    expect(late).toEqual({ state: switched.state, effects: [] })
    expect(selectLocale(late.state)).toBe(input.shows)
  })

  test("storage syncing during the user's own pick does not replace it", () => {
    const loading = transitionLanguage(readyOn("en", en), { type: "locale.requested", locale: "ar", cached: undefined })

    expect(transitionLanguage(loading.state, { type: "locale.synced", locale: "de", cached: de })).toEqual({
      state: loading.state,
      effects: [],
    })
  })

  test("a synced language loads without storing or announcing anything", () => {
    const result = replay(readyOn("en", en), [
      { type: "locale.synced", locale: "ar", cached: undefined },
      { type: "load.failed", attempt: 1 },
    ])

    expect(result.effects.filter((effect) => effect.type === "persist" || effect.type === "notify.error")).toEqual([])
  })

  test("picking the language that is already showing stores it without reloading", () => {
    const state = readyOn("en", en)

    expect(transitionLanguage(state, { type: "locale.requested", locale: "en", cached: en })).toEqual({
      state,
      effects: [{ type: "persist", locale: "en" }],
    })
  })

  test("disposal stops the load timer, keeps the dictionary readable and ignores later results", () => {
    const disposed = replay(readyOn("en", en), [
      { type: "locale.requested", locale: "ar", cached: undefined },
      { type: "disposed" },
    ])

    expect(disposed.effects.at(-1)).toEqual({ type: "timer.stop" })
    expect(shown(disposed.state)).toEqual({ locale: "en", dictionary: en })
    expect(transitionLanguage(disposed.state, { type: "load.succeeded", attempt: 1, dictionary: ar })).toEqual({
      state: disposed.state,
      effects: [],
    })
  })
})
