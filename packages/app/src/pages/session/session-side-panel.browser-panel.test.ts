import { beforeAll, describe, expect, mock, test } from "bun:test"
import type { ComponentProps, JSX } from "solid-js"

let createRoot: typeof import("solid-js").createRoot
let h: typeof import("solid-js/h").default
let render: typeof import("solid-js/web").render
let SessionSidePanelContentBranch: typeof import("./session-browser-panel-slot").SessionSidePanelContentBranch

type DivProps = ComponentProps<"div">

const panel = {
  opened: () => false,
  open() {},
  close() {},
  toggle() {},
}

beforeAll(async () => {
  mock.module("solid-js", () => import("solid-js/dist/solid.js"))
  mock.module("solid-js/store", () => import("solid-js/store/dist/store.js"))
  mock.module("solid-js/web", () => import("solid-js/web/dist/web.js"))
  h = (await import("solid-js/h")).default
  Object.assign(globalThis, {
    React: { Fragment: h.Fragment, createElement: h },
  })

  mock.module("@/components/browser-panel", () => ({
    BrowserPanel: (props: DivProps) => h("div", { ...props, "data-testid": "browser-panel-content" }, "BrowserPanel"),
  }))

  createRoot = (await import("solid-js")).createRoot
  render = (await import("solid-js/web")).render
  SessionSidePanelContentBranch = (await import("./session-browser-panel-slot")).SessionSidePanelContentBranch
})

describe("SessionSidePanel browser panel placement", () => {
  test("renders the browser panel branch when browser panel state is open", () => {
    createRoot((dispose) => {
      const host = document.createElement("div")
      const cleanup = render(
        () =>
          SessionSidePanelContentBranch({
            browserOpen: () => true,
            fallback: h("div", { "data-testid": "files-panel" }, "Files") as unknown as JSX.Element,
            panel,
          }),
        host,
      )

      expect(host.querySelector("#browser-panel")).toBeTruthy()
      expect(host.querySelector('[data-testid="browser-panel-content"]')?.textContent).toBe("BrowserPanel")
      expect(host.querySelector('[data-testid="files-panel"]')).toBeNull()

      cleanup()
      dispose()
    })
  })

  test("renders the existing panel content when browser panel state is closed", () => {
    createRoot((dispose) => {
      const host = document.createElement("div")
      const cleanup = render(
        () =>
          SessionSidePanelContentBranch({
            browserOpen: () => false,
            fallback: h("div", { "data-testid": "files-panel" }, "Files") as unknown as JSX.Element,
            panel,
          }),
        host,
      )

      expect(host.querySelector("#browser-panel")?.getAttribute("aria-hidden")).toBe("true")
      expect(host.querySelector('[data-testid="files-panel"]')?.textContent).toBe("Files")

      cleanup()
      dispose()
    })
  })
})
