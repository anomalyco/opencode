/** @jsxImportSource solid-js */
import { beforeAll, describe, expect, mock, test } from "bun:test"
import type { ComponentProps } from "solid-js"

let BrowserPanelToolbar: typeof import("./BrowserPanelToolbar").BrowserPanelToolbar
let h: typeof import("solid-js/h").default
let render: typeof import("solid-js/web").render

type IconProps = ComponentProps<"span"> & {
  name: string
  size?: string
}

beforeAll(async () => {
  mock.module("solid-js", () => import("solid-js/dist/solid.js"))
  mock.module("solid-js/web", () => import("solid-js/web/dist/web.js"))
  h = (await import("solid-js/h")).default
  Object.assign(globalThis, {
    React: { Fragment: h.Fragment, createElement: h },
  })

  mock.module("@opencode-ai/ui/icon", () => ({
    Icon: (props: IconProps) =>
      h("span", {
        "aria-hidden": "true",
        "data-component": "icon",
        "data-icon": props.name,
        "data-size": props.size,
      }),
  }))

  render = (await import("solid-js/web")).render
  BrowserPanelToolbar = (await import("./BrowserPanelToolbar")).BrowserPanelToolbar
})

function renderToolbar(props: Partial<ComponentProps<typeof BrowserPanelToolbar>> = {}) {
  const events: string[] = []
  const host = document.createElement("div")
  document.body.append(host)
  const cleanup = render(
    () =>
      BrowserPanelToolbar({
        canGoBack: true,
        canGoForward: true,
        count: 2,
        draftUrl: "https://opencode.ai/docs",
        inspectDisabled: false,
        inspectMode: false,
        isLoading: false,
        open: true,
        screenshotCaptured: false,
        onBack: () => events.push("back"),
        onClose: () => events.push("close"),
        onDraftUrlChange: (value) => events.push(`draft:${value}`),
        onForward: () => events.push("forward"),
        onInspect: () => events.push("inspect"),
        onNavigate: () => events.push("navigate"),
        onOpen: () => events.push("open"),
        onReload: () => events.push("reload"),
        onScreenshot: () => events.push("screenshot"),
        ...props,
      }),
    host,
  )
  return { cleanup, events, host }
}

describe("BrowserPanelToolbar", () => {
  test("renders icon-only toolbar controls with accessible names and titles", () => {
    const toolbar = renderToolbar({ inspectMode: true })

    const input = toolbar.host.querySelector('input[aria-label="Browser URL"]') as HTMLInputElement
    expect(input.value).toBe("https://opencode.ai/docs")
    expect(input.type).toBe("url")
    expect(input.name).toBe("browser-url")
    expect(input.autocomplete).toBe("off")
    expect(input.placeholder).toBe("Enter a URL…")
    expect([...toolbar.host.querySelectorAll("button")].map((button) => button.textContent?.trim())).toEqual([
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
    ])
    expect([...toolbar.host.querySelectorAll("button")].map((button) => button.getAttribute("aria-label"))).toEqual([
      "Go back",
      "Go forward",
      "Reload page",
      "Navigate to URL",
      "Take screenshot",
      "Annotate page",
      "More browser actions",
      "Close browser panel",
    ])
    expect([...toolbar.host.querySelectorAll("button")].map((button) => button.getAttribute("title"))).toEqual([
      "Go back",
      "Go forward",
      "Reload page",
      "Navigate to URL",
      "Take screenshot",
      "Annotate page",
      "More browser actions unavailable",
      "Close browser panel",
    ])
    expect([...toolbar.host.querySelectorAll('[data-component="icon"]')].map((icon) => icon.getAttribute("data-icon"))).toEqual([
      "arrow-left",
      "arrow-right",
      "reset",
      "enter",
      "photo",
      "window-cursor",
      "dot-grid",
      "close",
    ])
    expect(toolbar.host.querySelector('button[aria-label="Annotate page"]')?.getAttribute("aria-pressed")).toBe("true")
    expect(toolbar.host.querySelector('button[aria-label="Annotate page"]')?.className).toContain("browser-panel-button-active")

    toolbar.cleanup()
    toolbar.host.remove()
  })

  test("does not use the active annotation treatment when inspect mode is off", () => {
    const toolbar = renderToolbar({ inspectMode: false })

    expect(toolbar.host.querySelector('button[aria-label="Annotate page"]')?.getAttribute("aria-pressed")).toBe("false")
    expect(toolbar.host.querySelector('button[aria-label="Annotate page"]')?.className).not.toContain("browser-panel-button-active")

    toolbar.cleanup()
    toolbar.host.remove()
  })

  test("keeps toolbar actions wired while preserving disabled states", () => {
    const toolbar = renderToolbar({ canGoBack: false, canGoForward: false, inspectDisabled: true, open: true })

    expect((toolbar.host.querySelector('button[aria-label="Go back"]') as HTMLButtonElement).disabled).toBe(true)
    expect((toolbar.host.querySelector('button[aria-label="Go forward"]') as HTMLButtonElement).disabled).toBe(true)
    expect((toolbar.host.querySelector('button[aria-label="Annotate page"]') as HTMLButtonElement).disabled).toBe(true)
    expect((toolbar.host.querySelector('button[aria-label="Reload page"]') as HTMLButtonElement).disabled).toBe(false)
    expect((toolbar.host.querySelector('button[aria-label="Take screenshot"]') as HTMLButtonElement).disabled).toBe(false)
    expect((toolbar.host.querySelector('button[aria-label="More browser actions"]') as HTMLButtonElement).disabled).toBe(true)
    expect((toolbar.host.querySelector('button[aria-label="Close browser panel"]') as HTMLButtonElement).disabled).toBe(false)

    ;(toolbar.host.querySelector('button[aria-label="Reload page"]') as HTMLButtonElement).click()
    ;(toolbar.host.querySelector('button[aria-label="Take screenshot"]') as HTMLButtonElement).click()
    ;(toolbar.host.querySelector('button[aria-label="Close browser panel"]') as HTMLButtonElement).click()
    ;(toolbar.host.querySelector('button[aria-label="Navigate to URL"]') as HTMLButtonElement).click()

    expect(toolbar.events).toEqual(["reload", "screenshot", "close", "open"])

    toolbar.cleanup()
    toolbar.host.remove()
  })

  test("announces loading state through the reload control and status text", () => {
    const toolbar = renderToolbar({ isLoading: true })

    const reload = toolbar.host.querySelector('button[aria-label="Page loading"]') as HTMLButtonElement
    expect(reload.disabled).toBe(true)
    expect(reload.title).toBe("Page loading")
    expect(toolbar.host.querySelector('[role="status"]')?.textContent?.trim()).toBe("Page loading")

    toolbar.cleanup()
    toolbar.host.remove()
  })

  test("disables browser-only icon buttons when the panel is closed", () => {
    const toolbar = renderToolbar({ open: false })

    expect((toolbar.host.querySelector('button[aria-label="Go back"]') as HTMLButtonElement).disabled).toBe(true)
    expect((toolbar.host.querySelector('button[aria-label="Go forward"]') as HTMLButtonElement).disabled).toBe(true)
    expect((toolbar.host.querySelector('button[aria-label="Reload page"]') as HTMLButtonElement).disabled).toBe(true)
    expect((toolbar.host.querySelector('button[aria-label="Take screenshot"]') as HTMLButtonElement).disabled).toBe(true)
    expect((toolbar.host.querySelector('button[aria-label="Annotate page"]') as HTMLButtonElement).disabled).toBe(true)
    expect((toolbar.host.querySelector('button[aria-label="Close browser panel"]') as HTMLButtonElement).disabled).toBe(true)
    expect((toolbar.host.querySelector('button[aria-label="Navigate to URL"]') as HTMLButtonElement).disabled).toBe(false)

    toolbar.cleanup()
    toolbar.host.remove()
  })
})
