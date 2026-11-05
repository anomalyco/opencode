import { afterEach, describe, expect, jest, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { createPresence } from "../src/runtime/presence"

const cleanups: Array<() => void> = []

afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
  document.documentElement.removeAttribute("data-motion")
  jest.useRealTimers()
})

function setup(input: { show: boolean; element?: boolean }) {
  const element = document.createElement("div")
  // Browsers compute "none" without an animation; happy-dom computes an empty string.
  element.style.animationName = "none"
  document.body.append(element)

  return createRoot((dispose) => {
    const [show, setShow] = createSignal(input.show)
    const [target, setTarget] = createSignal<HTMLElement | null>(input.element === false ? null : element)
    const presence = createPresence({ show, element: target })

    cleanups.push(() => {
      dispose()
      element.remove()
    })

    return { element, presence, setShow, setTarget }
  })
}

function animate(element: HTMLElement, name: string) {
  element.style.animationName = name
  element.dispatchEvent(new AnimationEvent("animationstart", { animationName: name }))
}

describe("createPresence", () => {
  test("starts from the initial show value", () => {
    expect(setup({ show: true }).presence.state()).toBe("present")
    expect(setup({ show: false }).presence.state()).toBe("hidden")
    expect(setup({ show: false }).presence.present()).toBe(false)
  })

  test("enters at once, with or without an enter animation", () => {
    const view = setup({ show: false })

    view.setShow(true)
    expect(view.presence.state()).toBe("present")
    expect(view.presence.present()).toBe(true)
  })

  test("hides at once without an exit animation, as under reduced motion", () => {
    const view = setup({ show: true })

    view.setShow(false)
    expect(view.presence.state()).toBe("hidden")
    expect(view.presence.present()).toBe(false)
  })

  test("stays present while the exit animation runs and hides when it ends", () => {
    const view = setup({ show: true })
    animate(view.element, "enter")

    view.element.style.animationName = "exit"
    view.setShow(false)
    expect(view.presence.state()).toBe("hiding")
    expect(view.presence.present()).toBe(true)

    view.element.dispatchEvent(new AnimationEvent("animationstart", { animationName: "exit" }))
    view.element.dispatchEvent(new AnimationEvent("animationend", { animationName: "enter" }))
    expect(view.presence.state()).toBe("hiding")

    view.element.dispatchEvent(new AnimationEvent("animationend", { animationName: "exit" }))
    expect(view.presence.state()).toBe("hidden")
  })

  test("hides when the exit animation is cancelled", () => {
    const view = setup({ show: true })
    view.element.style.animationName = "exit"
    view.setShow(false)

    view.element.dispatchEvent(new AnimationEvent("animationcancel", { animationName: "exit" }))
    expect(view.presence.state()).toBe("hidden")
  })

  test("ignores animation events from children", () => {
    const view = setup({ show: true })
    const child = document.createElement("span")
    view.element.append(child)
    view.element.style.animationName = "exit"
    view.setShow(false)

    child.dispatchEvent(new AnimationEvent("animationend", { animationName: "exit", bubbles: true }))
    expect(view.presence.state()).toBe("hiding")
  })

  test("hides at once when the running animation did not change", () => {
    const view = setup({ show: true })
    animate(view.element, "pulse")

    view.setShow(false)
    expect(view.presence.state()).toBe("hidden")
  })

  test("hides at once when the element is not displayed", () => {
    const view = setup({ show: true })
    view.element.style.animationName = "exit"
    view.element.style.display = "none"

    view.setShow(false)
    expect(view.presence.state()).toBe("hidden")
  })

  test("hides at once without an element", () => {
    const view = setup({ show: true, element: false })

    view.setShow(false)
    expect(view.presence.state()).toBe("hidden")
  })

  test("comes back when shown again during the exit animation", () => {
    const view = setup({ show: true })
    view.element.style.animationName = "exit"
    view.setShow(false)

    view.element.style.animationName = "enter"
    view.setShow(true)
    expect(view.presence.state()).toBe("present")

    view.element.dispatchEvent(new AnimationEvent("animationend", { animationName: "exit" }))
    expect(view.presence.state()).toBe("present")
  })

  test("runs an exit-only animation again on every hide", () => {
    const view = setup({ show: true })

    const hide = () => {
      view.element.style.animationName = "exit"
      view.setShow(false)
      expect(view.presence.state()).toBe("hiding")
      view.element.dispatchEvent(new AnimationEvent("animationstart", { animationName: "exit" }))
      view.element.dispatchEvent(new AnimationEvent("animationend", { animationName: "exit" }))
      expect(view.presence.state()).toBe("hidden")
    }

    hide()
    view.element.style.animationName = "none"
    view.setShow(true)
    hide()
  })

  test("stops listening to a replaced element", () => {
    const view = setup({ show: true })
    const previous = view.element
    const next = document.createElement("div")
    document.body.append(next)
    view.setTarget(next)
    next.style.animationName = "exit"
    view.setShow(false)

    previous.dispatchEvent(new AnimationEvent("animationend", { animationName: "exit" }))
    expect(view.presence.state()).toBe("hiding")

    next.dispatchEvent(new AnimationEvent("animationend", { animationName: "exit" }))
    expect(view.presence.state()).toBe("hidden")
    next.remove()
  })

  test("hides on the fallback timer when the exit animation never ends", () => {
    jest.useFakeTimers()
    const view = setup({ show: true })
    view.element.style.animationName = "exit"
    view.element.style.animationDuration = "300ms"
    view.setShow(false)
    expect(view.presence.state()).toBe("hiding")

    // The computed duration plus 50ms of grace.
    jest.advanceTimersByTime(349)
    expect(view.presence.state()).toBe("hiding")
    jest.advanceTimersByTime(1)
    expect(view.presence.state()).toBe("hidden")
  })

  test("hides at once when the element is removed mid-exit", () => {
    const view = setup({ show: true })
    view.element.style.animationName = "exit"
    view.setShow(false)
    expect(view.presence.state()).toBe("hiding")

    view.setTarget(null)
    expect(view.presence.state()).toBe("hidden")
  })

  test("waits for a transition exit to end or cancel, ignoring transitions of children", () => {
    const view = setup({ show: true })
    const child = document.createElement("span")
    view.element.append(child)
    view.element.style.transitionProperty = "opacity"
    view.element.style.transitionDuration = "200ms"

    view.setShow(false)
    expect(view.presence.state()).toBe("hiding")
    child.dispatchEvent(new TransitionEvent("transitionend", { propertyName: "opacity", bubbles: true }))
    expect(view.presence.state()).toBe("hiding")
    view.element.dispatchEvent(new TransitionEvent("transitionend", { propertyName: "opacity" }))
    expect(view.presence.state()).toBe("hidden")

    view.setShow(true)
    view.setShow(false)
    expect(view.presence.state()).toBe("hiding")
    view.element.dispatchEvent(new TransitionEvent("transitioncancel", { propertyName: "opacity" }))
    expect(view.presence.state()).toBe("hidden")
  })

  test("skips the exit animation under Reduce Motion", () => {
    document.documentElement.setAttribute("data-motion", "reduce")
    const view = setup({ show: true })
    view.element.style.animationName = "exit"

    view.setShow(false)
    expect(view.presence.state()).toBe("hidden")
  })

  test("hides when Reduce Motion turns on mid-exit", async () => {
    const view = setup({ show: true })
    view.element.style.animationName = "exit"
    view.setShow(false)
    expect(view.presence.state()).toBe("hiding")

    document.documentElement.setAttribute("data-motion", "reduce")
    // Mutation observers deliver in a microtask.
    await Promise.resolve()
    expect(view.presence.state()).toBe("hidden")
  })
})
