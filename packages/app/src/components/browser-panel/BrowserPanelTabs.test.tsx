/** @jsxImportSource solid-js */
import { beforeAll, describe, expect, mock, test } from "bun:test"
import type { ComponentProps } from "solid-js"

let BrowserPanelTabs: typeof import("./BrowserPanelTabs").BrowserPanelTabs
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
  BrowserPanelTabs = (await import("./BrowserPanelTabs")).BrowserPanelTabs
})

describe("BrowserPanelTabs", () => {
  test("renders an accessible icon-first tab list without nested interactive tab controls", () => {
    const host = document.createElement("div")
    const cleanup = render(
      () =>
        BrowserPanelTabs({
          activeTabId: "browser-2",
          tabs: [
            { id: "browser-1", title: "Docs", url: "https://opencode.ai/docs" },
            { id: "browser-2", title: "", url: "" },
          ],
          onCloseTab: () => undefined,
          onNewTab: () => undefined,
          onSelectTab: () => undefined,
        }),
      host,
    )

    expect(host.querySelector('[role="list"]')?.getAttribute("aria-label")).toBe("Browser tabs")
    expect(host.querySelectorAll('[role="tab"]')).toHaveLength(0)
    expect([...host.querySelectorAll(".browser-tab")].map((tab) => tab.tagName)).toEqual(["LI", "LI"])
    expect([...host.querySelectorAll('button[aria-current]')].map((button) => button.getAttribute("aria-current"))).toEqual([
      "page",
    ])
    expect([...host.querySelectorAll('button.browser-tab-button')].map((tab) => tab.getAttribute("title"))).toEqual([
      "https://opencode.ai/docs",
      "New tab",
    ])
    expect([...host.querySelectorAll('button.browser-tab-button')].map((tab) => tab.textContent?.trim())).toEqual([
      "Docs",
      "New tab",
    ])
    expect(
      [...host.querySelectorAll('button.browser-tab-button')].every((button) => button.querySelector("button") === null),
    ).toBe(true)
    expect([...host.querySelectorAll('[data-component="icon"]')].map((icon) => icon.getAttribute("data-icon"))).toEqual([
      "browser",
      "close",
      "browser",
      "close",
      "plus",
    ])
    expect(host.querySelector('button[aria-label="New browser tab"]')?.getAttribute("title")).toBe("New tab")
    expect(host.querySelector('button[aria-label="Close tab"]')?.getAttribute("title")).toBe("Close tab")

    cleanup()
  })

  test("selects, closes, and creates tabs without close clicks selecting the tab", () => {
    const events: string[] = []
    const host = document.createElement("div")
    document.body.append(host)
    const cleanup = render(
      () =>
        BrowserPanelTabs({
          activeTabId: "browser-1",
          tabs: [{ id: "browser-1", title: "OpenCode", url: "https://opencode.ai" }],
          onCloseTab: (id) => events.push(`close:${id}`),
          onNewTab: () => events.push("new"),
          onSelectTab: (id) => events.push(`select:${id}`),
        }),
      host,
    )

    ;(host.querySelector("button.browser-tab-button") as HTMLButtonElement).click()
    ;(host.querySelector('button[aria-label="Close tab"]') as HTMLButtonElement).click()
    ;(host.querySelector('button[aria-label="New browser tab"]') as HTMLButtonElement).click()

    expect(events).toEqual(["select:browser-1", "close:browser-1", "new"])

    cleanup()
    host.remove()
  })

  test("renders the default browser tab without a close affordance", () => {
    const events: string[] = []
    const host = document.createElement("div")
    const cleanup = render(
      () =>
        BrowserPanelTabs({
          activeTabId: "default",
          tabs: [{ id: "default", title: "", url: "" }],
          onCloseTab: (id) => events.push(`close:${id}`),
          onNewTab: () => events.push("new"),
          onSelectTab: (id) => events.push(`select:${id}`),
        }),
      host,
    )

    expect(host.querySelector('button[aria-label="Close tab"]')).toBeNull()
    expect([...host.querySelectorAll('[data-component="icon"]')].map((icon) => icon.getAttribute("data-icon"))).toEqual([
      "browser",
      "plus",
    ])

    cleanup()
  })
})
