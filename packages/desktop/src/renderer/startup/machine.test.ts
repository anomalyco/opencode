import { describe, expect, test } from "bun:test"
import {
  createStartupState,
  FADE_TIMEOUT_MS,
  HYDRATION_TIMEOUT_MS,
  selectDrawingPaused,
  selectFirstLaunch,
  selectInterfaceMounted,
  selectOverlayMounted,
  selectSidecar,
  selectStartupFailure,
  selectStartupLocale,
  selectStartupRevealed,
  transitionStartup,
  type StartupEffect,
  type StartupEvent,
  type StartupState,
} from "./machine"

const sidecar = { url: "http://127.0.0.1:4096" }

const moved = { url: "http://127.0.0.1:5096" }

function start(input: { firstLaunch?: boolean; preview?: boolean; reducedMotion?: boolean; initialUrl?: string } = {}) {
  return createStartupState({
    initialUrl: input.initialUrl ?? "/",
    route: { type: "home" },
    firstLaunch: "firstLaunch" in input ? input.firstLaunch : false,
    preview: input.preview ?? false,
    reducedMotion: input.reducedMotion ?? false,
  })
}

// Folds events through the machine and keeps the effects of each step.
function replay(events: readonly StartupEvent[], from: StartupState = start().state) {
  return events.reduce<{ state: StartupState; effects: (readonly StartupEffect[])[] }>(
    (result, event) => {
      const next = transitionStartup(result.state, event)

      return { state: next.state, effects: [...result.effects, next.effects] }
    },
    { state: from, effects: [] },
  )
}

const notify: StartupEffect = { type: "notify-theme-ready" }

const cancel: StartupEffect = { type: "cancel-timer" }

const hydration: StartupEffect[] = [
  cancel,
  { type: "start-timer", timer: "hydration", timeoutMs: HYDRATION_TIMEOUT_MS },
]

const fade: StartupEffect[] = [cancel, { type: "start-timer", timer: "fade", timeoutMs: FADE_TIMEOUT_MS }]

// Everything a returning launch waits for before the app interface mounts.
const mounted: StartupEvent[] = [
  { type: "theme.applied" },
  { type: "locale.settled", locale: "de" },
  { type: "plugin-servers.ready" },
  { type: "route.preloaded" },
  { type: "sidecar.ready", data: sidecar },
]

describe("desktop startup", () => {
  test("shows the error page when the local server never answers", () => {
    const result = replay([
      { type: "theme.applied" },
      { type: "sidecar.timed-out" },
      { type: "sidecar.ready", data: sidecar },
    ])

    expect(result.state.status).toBe("failed")
    expect(selectStartupFailure(result.state)?.error).toHaveProperty("localServerStartup", true)
    expect(selectOverlayMounted(result.state)).toBe(false)
    expect(result.effects).toEqual([[notify], [cancel], []])
  })

  test("shows the window with the error page when a fresh install never learns whether to onboard", () => {
    const result = replay(
      [{ type: "theme.applied" }, { type: "sidecar.timed-out" }, { type: "first-launch.settled", pending: true }],
      start({ firstLaunch: undefined }).state,
    )

    expect(start({ firstLaunch: undefined }).effects[0]).toEqual({ type: "check-first-launch" })
    expect(result.state.status).toBe("failed")
    // Nothing was shown before: neither the splash nor the window.
    expect(result.effects).toEqual([[], [notify, cancel], []])
  })

  test.each([
    ["plugin servers", mounted.filter((event) => event.type !== "plugin-servers.ready"), "booting"],
    ["the locale", mounted.filter((event) => event.type !== "locale.settled"), "booting"],
    ["the route", mounted.filter((event) => event.type !== "route.preloaded"), "hydrating"],
    ["tabs", mounted, "hydrating"],
  ] satisfies [string, StartupEvent[], string][])(
    "shows the app with the server it has when %s never settle",
    (_name, events, waiting) => {
      const before = replay(events)
      const result = replay([{ type: "hydration.timed-out" }], before.state)

      expect(before.state.status).toBe(waiting)
      expect(result.state.status).toBe("fading")
      expect(selectInterfaceMounted(result.state)).toBe(true)
      expect(selectSidecar(result.state)).toBe(sidecar)
      expect(result.effects).toEqual([fade])
    },
  )

  test("shows the app when onboarding or the preview wordmark never finishes", () => {
    const preview = start({ firstLaunch: true, preview: true })
    const result = replay([...mounted, { type: "tabs.ready" }, { type: "hydration.timed-out" }], preview.state)

    expect(result.state.status).toBe("fading")
    expect(selectFirstLaunch(result.state)).toBe(true)
  })

  test("removes the overlay when its transition never ends", () => {
    const fading = replay([...mounted, { type: "tabs.ready" }])
    const result = replay([{ type: "fade.timed-out" }, { type: "overlay.transition-ended" }], fading.state)

    expect(fading.state.status).toBe("fading")
    expect(fading.effects.at(-1)).toEqual(fade)
    expect(result.state.status).toBe("revealed")
    expect(selectOverlayMounted(result.state)).toBe(false)
    expect(result.effects).toEqual([[cancel], []])
  })

  test("skips the fade under reduced motion", () => {
    const result = replay([...mounted, { type: "tabs.ready" }], start({ reducedMotion: true }).state)

    expect(result.state.status).toBe("revealed")
    expect(result.effects.at(-1)).toEqual([cancel])
  })

  test("ignores the wordmark animation outside the onboarding preview", () => {
    const booting = start({ firstLaunch: true }).state
    const result = transitionStartup(booting, { type: "drawing.ended" })

    expect(result.state).toBe(booting)
    expect(result.effects).toEqual([])
  })

  test("waits for the preview wordmark to draw once the window is focused", () => {
    const preview = start({ firstLaunch: true, preview: true }).state
    const ready = replay([...mounted, { type: "onboarding.settled" }, { type: "tabs.ready" }], preview)

    expect(selectDrawingPaused(preview)).toBe(true)
    expect(ready.state.status).toBe("hydrating")

    const drawn = replay(
      [{ type: "drawing.ended" }, { type: "drawing.started" }, { type: "drawing.ended" }],
      ready.state,
    )

    expect(drawn.effects).toEqual([[], [], fade])
    expect(drawn.state.status).toBe("fading")
  })

  test("falls back to English when the stored locale fails to load", () => {
    const result = replay(
      mounted.map((event) => (event.type === "locale.settled" ? { ...event, locale: undefined } : event)),
    )

    expect(result.state.status).toBe("hydrating")
    expect(selectStartupLocale(result.state)).toBeUndefined()
    expect(selectStartupLocale(replay(mounted).state)).toBe("de")
  })

  test("onboards a fresh install on the new-session route", () => {
    const fresh = start({ firstLaunch: undefined })

    const result = replay(
      [
        { type: "theme.applied" },
        { type: "first-launch.settled", pending: true },
        ...mounted.slice(1),
        { type: "tabs.ready" },
        { type: "onboarding.settled" },
        { type: "overlay.transition-ended" },
      ],
      fresh.state,
    )

    expect(fresh.effects).toEqual([
      { type: "check-first-launch" },
      { type: "preload-locale" },
      { type: "await-sidecar" },
      { type: "start-timer", timer: "sidecar", timeoutMs: 300_000 },
    ])
    expect(result.effects).toEqual([
      [],
      [{ type: "preload-route", url: "/new-session" }, notify],
      [],
      [],
      [],
      hydration,
      [],
      fade,
      [cancel],
    ])
    expect(result.state.status).toBe("revealed")
  })

  test("follows a sidecar that moves before or after the window's own answer", () => {
    const early = replay([{ type: "sidecar.changed", data: moved }, ...mounted])
    const late = replay([...mounted, { type: "tabs.ready" }, { type: "sidecar.changed", data: moved }])

    expect(selectSidecar(early.state)).toBe(moved)
    expect(late.state.status).toBe("fading")
    expect(selectSidecar(late.state)).toBe(moved)
  })

  test.each([
    ["the local server fails", [], "booting"],
    ["onboarding fails", mounted, "hydrating"],
  ] satisfies [string, StartupEvent[], string][])("shows the error page when %s", (_name, events, from) => {
    const error = new Error("boom")
    const before = replay(events)
    const result = transitionStartup(before.state, { type: "startup.failed", error })

    expect(before.state.status).toBe(from)
    expect(selectStartupFailure(result.state)).toEqual({ error })
    expect(selectInterfaceMounted(result.state)).toBe(false)
  })

  test.each([
    ["fading in", [...mounted, { type: "tabs.ready" }]],
    ["shown", [...mounted, { type: "tabs.ready" }, { type: "fade.timed-out" }]],
  ] satisfies [string, StartupEvent[]][])(
    "keeps the app when a late failure arrives while it is %s",
    (_name, events) => {
      // On dev onboarding that failed after the hydration timeout showed the app replaced it with the error page.
      const before = replay(events)
      const result = transitionStartup(before.state, { type: "startup.failed", error: new Error("boom") })

      expect(selectStartupRevealed(before.state)).toBe(true)
      expect(result.state).toBe(before.state)
      expect(selectInterfaceMounted(result.state)).toBe(true)
    },
  )

  test("stops its timer when the error boundary catches a render error", () => {
    const fresh = replay(
      [{ type: "theme.applied" }, { type: "boundary.tripped" }],
      start({ firstLaunch: undefined }).state,
    )

    expect(fresh.state.status).toBe("failed")
    expect(selectStartupFailure(fresh.state)).toBeUndefined()
    expect(fresh.effects).toEqual([[], [notify, cancel]])
  })

  test("ignores timers from a phase it has left", () => {
    const hydrating = replay(mounted).state
    const fading = replay([{ type: "tabs.ready" }], hydrating).state

    expect(transitionStartup(hydrating, { type: "sidecar.timed-out" }).state).toBe(hydrating)
    expect(transitionStartup(hydrating, { type: "fade.timed-out" }).state).toBe(hydrating)
    expect(transitionStartup(fading, { type: "hydration.timed-out" }).state).toBe(fading)
  })

  test("cancels its timer on dispose and ignores everything after", () => {
    const disposed = replay([{ type: "sidecar.ready", data: sidecar }, { type: "disposed" }])

    const after = replay(
      [...mounted, { type: "hydration.timed-out" }, { type: "startup.failed", error: 1 }],
      disposed.state,
    )

    expect(disposed.effects.at(-1)).toEqual([cancel])
    expect(after.state).toBe(disposed.state)
    expect(after.effects.flat()).toEqual([])
  })
})
