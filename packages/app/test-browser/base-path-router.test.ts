import { afterEach, beforeEach, expect, test } from "bun:test"
import { Route, useLocation, useNavigate } from "@solidjs/router"
import { createComponent, render } from "solid-js/web"
import { basePathRouter } from "../src/runtime/platform/base-path-router"

const originalUrl = window.location.href

beforeEach(() => {
  window.location.href = "http://localhost/"
})

afterEach(() => {
  window.location.href = originalUrl
})

function mount(url: string) {
  window.history.replaceState(null, "", url)
  const Router = basePathRouter("/opencode")
  let location!: ReturnType<typeof useLocation>
  let navigate!: ReturnType<typeof useNavigate>

  const Capture = () => {
    location = useLocation()
    navigate = useNavigate()

    return null
  }

  const dispose = render(
    () =>
      createComponent(Router, {
        get children() {
          return createComponent(Route, { path: "*", component: Capture })
        },
      }),
    document.createElement("div"),
  )

  return { location: () => location, navigate: () => navigate, dispose }
}

// Navigation commits inside a transition, so let it settle before reading the location.
const settle = () => new Promise((resolve) => setTimeout(resolve, 10))

test("the app sees paths without the base path while the address bar keeps it", async () => {
  const app = mount("/opencode/session/abc?x=1")

  expect(app.location().pathname).toBe("/session/abc")
  expect(app.location().search).toBe("?x=1")

  app.navigate()("/new-session", { state: { from: "test" } })
  await settle()

  expect(window.location.pathname).toBe("/opencode/new-session")
  expect(app.location().pathname).toBe("/new-session")
  expect(app.location().state).toEqual({ from: "test" })

  app.navigate()("/settings", { replace: true })
  await settle()

  expect(window.location.pathname).toBe("/opencode/settings")
  expect(app.location().pathname).toBe("/settings")

  app.dispose()
})

test("the bare base path is the app root", () => {
  const app = mount("/opencode/")

  expect(app.location().pathname).toBe("/")

  app.dispose()
})

test("going back restores the earlier path and its state", async () => {
  const app = mount("/opencode/")

  app.navigate()("/new-session", { state: { from: "first" } })
  await settle()
  app.navigate()("/settings")
  await settle()

  window.history.back()
  await settle()

  expect(window.location.pathname).toBe("/opencode/new-session")
  expect(app.location().pathname).toBe("/new-session")
  // The router keeps its own `_depth` alongside the app's state, as Solid's `Router` does.
  expect(app.location().state).toMatchObject({ from: "first" })

  app.dispose()
})
