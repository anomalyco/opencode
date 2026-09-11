import { expect, test } from "bun:test"
import { MemoryRouter, Route, createMemoryHistory, useNavigate, useParams } from "@solidjs/router"
import { createEffect, onCleanup } from "solid-js"
import { createComponent, render } from "solid-js/web"
import { createSessionOwnership } from "@/session/session-ownership"

test("session ownership follows navigation, back, forward, replacement, and route disposal", async () => {
  const host = document.createElement("div")
  const history = createMemoryHistory()
  history.set({ value: "/session/A", replace: true, scroll: false })
  const captured: ReturnType<ReturnType<typeof createSessionOwnership>["capture"]>[] = []
  const navigate: ReturnType<typeof useNavigate>[] = []
  const cleaned: string[] = []
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

  const Session = () => {
    const params = useParams<{ id: string }>()
    const ownership = createSessionOwnership(() => params.id)
    const label = document.createElement("div")
    navigate.push(useNavigate())
    createEffect(() => {
      label.textContent = params.id
      captured.push(ownership.capture())
    })
    onCleanup(() => cleaned.push("session"))
    return label
  }

  const dispose = render(
    () =>
      createComponent(MemoryRouter, {
        history,
        get children() {
          return [
            createComponent(Route, { path: "/", component: () => "Home" }),
            createComponent(Route, { path: "/session/:id", component: Session }),
          ]
        },
      }),
    host,
  )

  try {
    expect(host.textContent).toBe("A")
    expect(captured[0].current()).toBe(true)

    navigate[0]("/session/B")
    await settle()
    expect(host.textContent).toBe("B")
    expect(captured[0].current()).toBe(false)
    expect(captured[1].current()).toBe(true)

    history.back()
    await settle()
    expect(host.textContent).toBe("A")
    expect(captured[0].current()).toBe(false)
    expect(captured[1].current()).toBe(false)
    expect(captured[2].current()).toBe(true)

    history.forward()
    await settle()
    expect(host.textContent).toBe("B")
    expect(captured[2].current()).toBe(false)
    expect(captured[3].current()).toBe(true)
    expect(navigate).toHaveLength(1)
    expect(cleaned).toEqual([])

    navigate[0]("/", { replace: true })
    await settle()
    expect(host.textContent).toBe("Home")
    expect(captured.every((owner) => !owner.current())).toBe(true)
    expect(cleaned).toEqual(["session"])

    history.back()
    await settle()
    expect(host.textContent).toBe("A")
    expect(captured[4].current()).toBe(true)
    expect(navigate).toHaveLength(2)
  } finally {
    dispose()
  }

  expect(captured.every((owner) => !owner.current())).toBe(true)
  expect(cleaned).toEqual(["session", "session"])
})
