import { expect, test } from "bun:test"
import { arrive, stopScope, type TourApp, type TourAppearance, type TourDebug } from "./setup"

// The app as a stop's setup sees it, with the debug extension's store and the settings as plain state. Nothing renders:
// the debug bar is lazy, so it may still be loading when a stop ends.
function fakeApp(input: { debug?: TourDebug; appearance?: Required<TourAppearance> }) {
  const state = { ...input }

  const app: TourApp = {
    navigate: () => {},
    serverSegment: () => undefined,
    sessionPath: () => undefined,
    openTab: () => {},
    settings: () => true,
    appearance: () => state.appearance,
    setAppearance: (values) => {
      if (state.appearance) state.appearance = { ...state.appearance, ...values }
    },
    debug: () => state.debug,
    setDebug: (debug) => (state.debug = debug),
    palette: () => {},
    dialogOpen: () => false,
    closeDialog: () => {},
  }

  return { app, state }
}

test("a stop puts the debug bar back from its stored state while the bar hasn't mounted", async () => {
  // Knobs was left on in a hidden bar before the tour.
  const before = { visible: false, motion: true }
  const { app, state } = fakeApp({ debug: before })
  const scope = stopScope(app)

  await arrive({ id: "R-148", title: "Chip corners", debug: "bar" }, app, scope, new AbortController().signal)

  expect(state.debug).toEqual({ visible: true, motion: false })
  expect(document.querySelector("[data-component=debug-bar]")).toBeNull()

  scope.restore()

  expect(state.debug).toEqual(before)
})

test("a stop reads the settings it changes only once they've loaded", async () => {
  const { app, state } = fakeApp({})
  const scope = stopScope(app)

  const arrived = arrive(
    { id: "R-145", title: "Sidebar preview", appearance: { tabLayout: "vertical" } },
    app,
    scope,
    new AbortController().signal,
  )

  state.appearance = { tabLayout: "horizontal", sidebarOpen: false }
  await arrived

  expect(state.appearance).toEqual({ tabLayout: "vertical", sidebarOpen: false })

  scope.restore()

  expect(state.appearance).toEqual({ tabLayout: "horizontal", sidebarOpen: false })
})
