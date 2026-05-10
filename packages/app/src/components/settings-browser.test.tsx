/** @jsxImportSource solid-js */
import { beforeAll, describe, expect, mock, test } from "bun:test"
import type { ComponentProps, JSX } from "solid-js"

let SettingsBrowser: typeof import("./settings-browser").SettingsBrowser
let h: typeof import("solid-js/h").default
let render: typeof import("solid-js/web").render
const updateConfig = mock(async () => {})
const setConfig = mock(() => {})
let config: { browser?: { integratedTools?: { enabled?: boolean } } } = {}

type SwitchProps = {
  checked?: boolean
  onChange?: (checked: boolean) => void
  children?: JSX.Element
}

beforeAll(async () => {
  mock.module("solid-js", () => import("solid-js/dist/solid.js"))
  mock.module("solid-js/web", () => import("solid-js/web/dist/web.js"))
  h = (await import("solid-js/h")).default
  Object.assign(globalThis, {
    React: { Fragment: h.Fragment, createElement: h },
  })

  mock.module("@opencode-ai/ui/switch", () => ({
    Switch: (props: SwitchProps) =>
      h(
        "button",
        {
          type: "button",
          role: "switch",
          "aria-checked": props.checked ? "true" : "false",
          onClick: () => props.onChange?.(!props.checked),
        },
        props.children,
      ),
  }))
  mock.module("@/context/language", () => ({
    useLanguage: () => ({
      t: (key: string) =>
        ({
          "settings.browser.section": "Browser",
          "settings.browser.integratedTools.title": "Integrated browser agent tools",
          "settings.browser.integratedTools.description":
            "When off, the agent will not receive integrated browser tools automatically.",
        })[key] ?? key,
    }),
  }))
  mock.module("@/context/global-sync", () => ({
    useGlobalSync: () => ({
      data: { get config() { return config } },
      set: setConfig,
      updateConfig,
    }),
  }))

  render = (await import("solid-js/web")).render
  SettingsBrowser = (await import("./settings-browser")).SettingsBrowser
})

function renderBrowserSettings(props: Partial<ComponentProps<typeof SettingsBrowser>> = {}) {
  const host = document.createElement("div")
  document.body.append(host)
  const cleanup = render(() => SettingsBrowser(props), host)
  return { cleanup, host }
}

describe("SettingsBrowser", () => {
  test("shows a browser section with a default-on integrated browser tools toggle and disabled-state copy", () => {
    config = {}
    const settings = renderBrowserSettings()

    expect(settings.host.textContent).toContain("Browser")
    expect(settings.host.textContent).toContain("Integrated browser agent tools")
    expect(settings.host.textContent).toContain(
      "When off, the agent will not receive integrated browser tools automatically.",
    )
    expect(settings.host.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("true")

    settings.cleanup()
    settings.host.remove()
  })

  test("renders persisted disabled integrated browser tools state", () => {
    config = { browser: { integratedTools: { enabled: false } } }
    const settings = renderBrowserSettings()

    expect(settings.host.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("false")

    settings.cleanup()
    settings.host.remove()
  })

  test("persists integrated browser tools toggle changes through global config", () => {
    config = {}
    updateConfig.mockClear()
    setConfig.mockClear()
    const settings = renderBrowserSettings()

    ;(settings.host.querySelector('[role="switch"]') as HTMLButtonElement).click()

    expect(setConfig).toHaveBeenCalledWith("config", "browser", { integratedTools: { enabled: false } })
    expect(updateConfig).toHaveBeenCalledWith({ browser: { integratedTools: { enabled: false } } })

    settings.cleanup()
    settings.host.remove()
  })
})
