import { describe, expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { createKeybindSettingsController } from "../src/settings/keybinds/keybinds"

function setup(
  overrides: Record<string, string> = {},
  plugins?: ReadonlySet<string>,
  active?: () => boolean,
  initialLeader?: string,
) {
  const changes: [string, string][] = []
  const [leader, setLeader] = createSignal(initialLeader)
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
            { id: "session.chord", title: "Chord", keybind: "mod+k mod+c" },
            { id: "session.next", title: "Next", keybind: "<leader> n" },
            { id: "acme.open", plugin: "acme", title: "Open Acme", section: "session" },
          ],
          options: [],
          suspend: () => {
            suppression.push(false)

            return () => suppression.push(true)
          },
        },
        plugins: plugins && (() => plugins),
        settings: {
          keymaps: { leader, setLeader },
          keybinds: {
            all: () => overrides,
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
        active,
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
    leader,
    dispose,
  }
}

function modKey(key: string) {
  const mac = /(Mac|iPod|iPhone|iPad)/.test(navigator.platform)

  return new KeyboardEvent("keydown", { key, ctrlKey: !mac, metaKey: mac, bubbles: true, cancelable: true })
}

function key(key: string, init?: KeyboardEventInit) {
  return new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init })
}

const enter = () => document.dispatchEvent(key("Enter"))

describe("keybind settings controller", () => {
  test("derives the catalog, effective bindings, and filtered groups", () => {
    const state = setup({ "session.beta": "alt+k" })

    expect(state.controller.catalog.title("session.alpha")).toBe("Alpha")
    expect(state.controller.catalog.keybind("session.beta")).toBe("Alt+K")
    expect(state.controller.catalog.filtered("alt k").get("Session")).toEqual(["session.beta"])
    expect(state.controller.settings.hasOverrides()).toBe(true)

    state.dispose()
  })

  test.each([
    { plugins: new Set(["acme"]), listed: true },
    { plugins: new Set(["other"]), listed: false },
  ])("lists a plugin's remembered command only while the plugin is installed: $listed", (row) => {
    const state = setup({}, row.plugins)

    expect(state.controller.catalog.filtered("open acme").get("Session")).toEqual(row.listed ? ["acme.open"] : [])

    state.dispose()
  })

  test("captures bindings, rejects conflicts, and restores command handling", () => {
    const state = setup()

    state.controller.capture.toggle("session.beta")
    document.dispatchEvent(modKey("a"))
    enter()
    expect(state.changes).toEqual([])
    expect(state.notifications).toHaveLength(1)
    expect(state.controller.capture.active()).toBe("session.beta")

    document.dispatchEvent(modKey("x"))
    enter()
    expect(state.changes).toEqual([["session.beta", "mod+x"]])
    expect(state.suppression).toEqual([false, true])
    expect(state.controller.capture.active()).toBeNull()

    state.controller.capture.toggle("session.alpha")
    state.dispose()
    expect(state.suppression).toEqual([false, true, false, true])
    document.dispatchEvent(modKey("z"))
    enter()
    expect(state.changes).toEqual([["session.beta", "mod+x"]])
  })

  test("records a chord, and rejects one that starts or is started by another shortcut", () => {
    const state = setup()

    state.controller.capture.toggle("session.beta")
    document.dispatchEvent(modKey("k"))
    enter()
    expect(state.notifications.map((toast) => toast.description)).toEqual([expect.stringContaining("Chord")])

    document.dispatchEvent(modKey("j"))
    document.dispatchEvent(modKey("c"))
    expect(state.controller.capture.recorded()).not.toBe("")
    enter()
    expect(state.changes).toEqual([["session.beta", "mod+j mod+c"]])

    state.dispose()
  })

  test("records the leader key, and rejects one that starts another shortcut", () => {
    const state = setup()

    state.controller.capture.toggle("keymap.leader")
    document.dispatchEvent(modKey("a"))
    expect(state.leader()).toBeUndefined()
    expect(state.notifications.map((toast) => toast.description)).toEqual([expect.stringContaining("Alpha")])

    document.dispatchEvent(key("x", { ctrlKey: true }))
    expect(state.leader()).toBe(/(Mac|iPod|iPhone|iPad)/.test(navigator.platform) ? "ctrl+x" : "mod+x")
    expect(state.controller.capture.active()).toBeNull()

    state.dispose()
  })

  test("a leader chord starts with the leader, and clashes with shortcuts on the leader's key", () => {
    const state = setup({}, undefined, undefined, "alt+x")

    expect(state.controller.catalog.keybind("session.next")).toMatch(/X N$/)

    state.controller.capture.toggle("session.beta")
    state.controller.capture.insertLeader()
    document.dispatchEvent(key("n"))
    enter()
    expect(state.notifications.map((toast) => toast.description)).toEqual([expect.stringContaining("Next")])

    state.controller.capture.insertLeader()
    document.dispatchEvent(key("m"))
    enter()
    expect(state.changes).toEqual([["session.beta", "<leader> m"]])

    state.dispose()
  })

  test("moving the recording between rows keeps shortcuts suspended, and hiding the page resumes them", () => {
    const [active, setActive] = createSignal(true)
    const state = setup({}, undefined, active)

    state.controller.capture.toggle("session.alpha")
    state.controller.capture.toggle("session.beta")
    expect(state.controller.capture.active()).toBe("session.beta")
    expect(state.suppression).toEqual([false])

    setActive(false)
    expect(state.controller.capture.active()).toBeNull()
    expect(state.suppression).toEqual([false, true])

    state.dispose()
    expect(state.suppression).toEqual([false, true])
  })

  test("focusing or typing in a search field ends the recording and keeps the typed key", () => {
    const state = setup()
    const search = document.createElement("input")
    document.body.append(search)

    state.controller.capture.toggle("session.alpha")
    search.focus()
    expect(state.controller.capture.active()).toBeNull()
    expect(state.suppression).toEqual([false, true])

    state.controller.capture.toggle("session.alpha")
    const key = new KeyboardEvent("keydown", { key: "t", bubbles: true, cancelable: true })
    search.dispatchEvent(key)
    expect(key.defaultPrevented).toBe(false)
    expect(state.changes).toEqual([])
    expect(state.controller.capture.active()).toBeNull()
    expect(state.suppression).toEqual([false, true, false, true])

    search.remove()
    state.dispose()
  })

  test("resets persisted overrides and reports success", () => {
    const state = setup({ "session.alpha": "none" })

    state.controller.settings.reset()
    expect(state.resets()).toBe(1)
    expect(state.notifications[0]?.title).toBe("settings.shortcuts.reset.toast.title")

    state.dispose()
  })
})
