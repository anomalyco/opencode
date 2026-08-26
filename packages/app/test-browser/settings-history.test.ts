import { afterEach, describe, expect, test } from "bun:test"
import { MemoryRouter, Route, createMemoryHistory, useIsRouting, useLocation, useNavigate } from "@solidjs/router"
import { createComponent, createEffect, createRoot } from "solid-js"
import { render } from "solid-js/web"
import { createTitlebarHistory } from "../src/shell/titlebar/history-context"

const cleanup: (() => void)[] = []
afterEach(() => cleanup.splice(0).forEach((dispose) => dispose()))

function setup(initial = "/new-session?draftId=example") {
  const host = document.createElement("div")
  document.body.append(host)
  const memory = createMemoryHistory()
  memory.set({ value: initial, replace: true, scroll: false })
  const state = {} as {
    history: ReturnType<typeof createTitlebarHistory>
    navigate: ReturnType<typeof useNavigate>
    location: ReturnType<typeof useLocation>
    routing: ReturnType<typeof useIsRouting>
  }
  const dispose = render(
    () =>
      createComponent(MemoryRouter, {
        history: memory,
        root: (props) => {
          state.history = createTitlebarHistory()
          state.navigate = useNavigate()
          state.location = useLocation()
          state.routing = useIsRouting()
          return props.children
        },
        get children() {
          return createComponent(Route, { path: "*all", component: () => null })
        },
      }),
    host,
  )
  cleanup.push(() => {
    dispose()
    host.remove()
  })
  return {
    ...state,
    memory,
    async at(path: string) {
      await new Promise<void>((resolve) => {
        createRoot((dispose) => {
          createEffect(() => {
            if (state.routing()) return
            dispose()
            resolve()
          })
        })
      })
      expect(`${state.location.pathname}${state.location.search}`).toBe(path)
      expect(memory.get()).toBe(path)
    },
  }
}

describe("settings memory history", () => {
  test("closing and app forward traverse the same entries after replacing the settings tab", async () => {
    const app = setup()
    app.navigate("/settings?tab=general")
    await app.at("/settings?tab=general")
    app.navigate("/settings?tab=models", { replace: true })
    await app.at("/settings?tab=models")
    app.history.back()
    await app.at("/new-session?draftId=example")
    app.history.forward()
    await app.at("/settings?tab=models")
    app.history.back()
    await app.at("/new-session?draftId=example")
  })

  test("native back and forward retain the return destination without location state", async () => {
    const app = setup()
    app.navigate("/settings?tab=models")
    await app.at("/settings?tab=models")
    app.memory.back()
    await app.at("/new-session?draftId=example")
    app.memory.forward()
    await app.at("/settings?tab=models")
    expect(app.location.state).toBeUndefined()
    app.history.back()
    await app.at("/new-session?draftId=example")
    app.history.forward()
    await app.at("/settings?tab=models")
  })

  test("navigating after going back discards the actual forward history", async () => {
    const app = setup()
    app.navigate("/settings")
    await app.at("/settings")
    app.history.back()
    await app.at("/new-session?draftId=example")
    app.navigate("/new-session?draftId=other")
    await app.at("/new-session?draftId=other")
    app.history.forward()
    await app.at("/new-session?draftId=other")
    app.memory.back()
    await app.at("/new-session?draftId=example")
  })

  test("direct settings entry and a restarted memory router fall back home", async () => {
    const app = setup("/settings?tab=models")
    app.history.back()
    await app.at("/")
    app.history.forward()
    await app.at("/")
    app.memory.back()
    await app.at("/")
  })
})
