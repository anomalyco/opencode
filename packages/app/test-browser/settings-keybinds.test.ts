import { describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createKeybindSettingsController } from "../src/components/settings-keybinds"

function setup(overrides: Record<string, string> = {}) {
  const changes: [string, string][] = []
  const suppression: boolean[] = []
  const notifications: { title: string; description?: string }[] = []
  let resets = 0
  let controller: ReturnType<typeof createKeybindSettingsController>

  const dispose = createRoot((dispose) => {
    controller = createKeybindSettingsController(
      {
        command: {
          catalog: [
            { id: "session.alpha", title: "Alpha", keybind: "mod+a" },
            { id: "session.beta", title: "Beta", keybind: "mod+b" },
          ],
          options: [],
          keybinds: (enabled) => suppression.push(enabled),
        },
        settings: {
          current: { keybinds: overrides },
          keybinds: {
            get: (id) => overrides[id],
            set: (id, value) => {
              overrides[id] = value
              changes.push([id, value])
            },
            resetAll: () => {
              resets++
            },
          },
        },
        notify: (toast) => notifications.push(toast),
      },
      {
        locale: () => "en",
        t: (key, params) => {
          if (params) return `${key}:${Object.values(params).join("|")}`
          if (key === "common.key.alt") return "Alt"
          return String(key)
        },
      },
    )
    return dispose
  })

  return {
    controller: controller!,
    changes,
    suppression,
    notifications,
    resets: () => resets,
    dispose,
  }
}

function modKey(key: string) {
  const mac = /(Mac|iPod|iPhone|iPad)/.test(navigator.platform)
  return new KeyboardEvent("keydown", { key, ctrlKey: !mac, metaKey: mac, bubbles: true, cancelable: true })
}

describe("keybind settings controller", () => {
  test("derives the catalog, effective bindings, and filtered groups", () => {
    const state = setup({ "session.beta": "alt+k" })

    expect(state.controller.catalog.title("session.alpha")).toBe("Alpha")
    expect(state.controller.catalog.keybind("session.beta")).toBe("Alt+K")
    expect(state.controller.catalog.filtered("alt k").get("Session")).toEqual(["session.beta"])
    expect(state.controller.settings.hasOverrides()).toBe(true)

    state.dispose()
  })

  test("captures bindings, rejects conflicts, and restores command handling", () => {
    const state = setup()

    state.controller.capture.toggle("session.beta")
    document.dispatchEvent(modKey("a"))
    expect(state.changes).toEqual([])
    expect(state.notifications).toHaveLength(1)
    expect(state.controller.capture.active()).toBe("session.beta")

    document.dispatchEvent(modKey("x"))
    expect(state.changes).toEqual([["session.beta", "mod+x"]])
    expect(state.suppression).toEqual([false, true])
    expect(state.controller.capture.active()).toBeNull()

    state.controller.capture.toggle("session.alpha")
    state.dispose()
    expect(state.suppression).toEqual([false, true, false, true])
    document.dispatchEvent(modKey("z"))
    expect(state.changes).toEqual([["session.beta", "mod+x"]])
  })

  test("resets persisted overrides and reports success", () => {
    const state = setup({ "session.alpha": "none" })

    state.controller.settings.reset()
    expect(state.resets()).toBe(1)
    expect(state.notifications[0]?.title).toBe("settings.shortcuts.reset.toast.title")

    state.dispose()
  })
})
