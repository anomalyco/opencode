import { beforeAll, describe, expect, mock, test } from "bun:test"
import type { ComponentProps } from "solid-js"

let createRoot: typeof import("solid-js").createRoot
let createSignal: typeof import("solid-js").createSignal
let render: typeof import("solid-js/web").render
let h: typeof import("solid-js/h").default
let SessionHeaderBrowserToggle: typeof import("./session-header-browser-toggle").SessionHeaderBrowserToggle

type IconProps = ComponentProps<"span"> & {
  name: string
  size?: string
}

type ButtonProps = ComponentProps<"button"> & {
  variant?: string
}

type TooltipProps = {
  children: unknown
}

beforeAll(async () => {
  mock.module("solid-js", () => import("solid-js/dist/solid.js"))
  mock.module("solid-js/store", () => import("solid-js/store/dist/store.js"))
  mock.module("solid-js/web", () => import("solid-js/web/dist/web.js"))
  h = (await import("solid-js/h")).default
  Object.assign(globalThis, {
    React: { Fragment: h.Fragment, createElement: h },
  })

  mock.module("@opencode-ai/ui/button", () => ({
    Button: (props: ButtonProps) => h("button", props, props.children),
  }))
  mock.module("@opencode-ai/ui/icon", () => ({
    Icon: (props: IconProps) =>
      h("span", {
        "aria-hidden": "true",
        "data-component": "icon",
        "data-icon": props.name,
        "data-size": props.size,
      }),
  }))
  mock.module("@opencode-ai/ui/tooltip", () => ({
    Tooltip: (props: TooltipProps) => h("div", {}, props.children),
    TooltipKeybind: (props: TooltipProps) => h("div", {}, props.children),
  }))

  createRoot = (await import("solid-js")).createRoot
  createSignal = (await import("solid-js")).createSignal
  render = (await import("solid-js/web")).render
  SessionHeaderBrowserToggle = (await import("./session-header-browser-toggle")).SessionHeaderBrowserToggle
})

describe("SessionHeader browser panel toggle", () => {
  test("toggles the browser panel controller and renders accessible icon-first output", () => {
    createRoot((dispose) => {
      const [opened, setOpened] = createSignal(false)
      const host = document.createElement("div")
      const cleanup = render(
        () =>
          SessionHeaderBrowserToggle({
            browserPanel: {
              opened,
              toggle: () => setOpened(!opened()),
            },
          }),
        host,
      )

      const button = host.querySelector('button[aria-label="Browser"]')
      expect(button).toBeInstanceOf(HTMLButtonElement)
      expect(button?.getAttribute("aria-expanded")).toBe("false")
      expect(button?.getAttribute("aria-controls")).toBe("browser-panel")
      expect(button?.getAttribute("title")).toBe("Browser")
      expect(host.querySelector('[data-component="icon"]')?.getAttribute("data-icon")).toBe("browser")

      ;(button as HTMLButtonElement).click()

      expect(opened()).toBe(true)

      cleanup()
      dispose()
    })
  })
})
