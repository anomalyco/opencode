import { expect, test } from "bun:test"
import { MetaProvider, Title } from "@solidjs/meta"
import { MemoryRouter, Route, createMemoryHistory, useParams } from "@solidjs/router"
import { createMemo } from "solid-js"
import { createComponent, render } from "solid-js/web"

test("route cleanup cannot invalidate an owner list being disposed", async () => {
  const host = document.createElement("div")
  document.body.append(host)
  const history = createMemoryHistory()

  const RepoPage = () => {
    const params = useParams<{ id?: string }>()
    const title = createMemo(() => params.id ?? "")
    const button = document.createElement("button")
    button.textContent = "Back"
    button.addEventListener("click", () => history.set({ value: "/", scroll: false, replace: false }))
    return [
      createComponent(Title, {
        get children() {
          return title()
        },
      }),
      button,
    ]
  }

  const HomePage = () => {
    const button = document.createElement("button")
    button.textContent = "Go"
    button.addEventListener("click", () => history.set({ value: "/project", scroll: false, replace: false }))
    return button
  }

  const App = () =>
    createComponent(MetaProvider, {
      get children() {
        return createComponent(MemoryRouter, {
          history,
          get children() {
            return [
              createComponent(Route, { path: "/", component: HomePage }),
              createComponent(Route, { path: "/:id", component: RepoPage }),
            ]
          },
        })
      },
    })

  const dispose = render(() => createComponent(App, {}), host)
  const go = host.querySelector("button")
  expect(go?.textContent).toBe("Go")
  go?.click()
  await new Promise((resolve) => setTimeout(resolve, 0))

  const back = host.querySelector("button")
  expect(back?.textContent).toBe("Back")
  back?.click()
  await new Promise((resolve) => setTimeout(resolve, 0))

  expect(host.querySelector("button")?.textContent).toBe("Go")
  dispose()
  host.remove()
})
