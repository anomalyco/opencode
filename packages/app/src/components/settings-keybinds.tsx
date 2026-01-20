import { Component, For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { showToast } from "@opencode-ai/ui/toast"
import { formatKeybind, parseKeybind, useCommand } from "@/context/command"
import { useSettings } from "@/context/settings"

const IS_MAC = typeof navigator === "object" && /(Mac|iPod|iPhone|iPad)/.test(navigator.platform)
const PALETTE_ID = "command.palette"
const DEFAULT_PALETTE_KEYBIND = "mod+shift+p"

type KeybindGroup = "General" | "Session" | "Navigation" | "Model and agent" | "Terminal" | "Prompt"

type KeybindMeta = {
  title: string
  group: KeybindGroup
}

const GROUPS: KeybindGroup[] = ["General", "Session", "Navigation", "Model and agent", "Terminal", "Prompt"]

function groupFor(id: string): KeybindGroup {
  if (id === PALETTE_ID) return "General"
  if (id.startsWith("terminal.")) return "Terminal"
  if (id.startsWith("model.") || id.startsWith("agent.") || id.startsWith("mcp.")) return "Model and agent"
  if (id.startsWith("file.")) return "Navigation"
  if (id.startsWith("prompt.")) return "Prompt"
  if (
    id.startsWith("session.") ||
    id.startsWith("message.") ||
    id.startsWith("permissions.") ||
    id.startsWith("steps.") ||
    id.startsWith("review.")
  )
    return "Session"

  return "General"
}

function isModifier(key: string) {
  return key === "Shift" || key === "Control" || key === "Alt" || key === "Meta"
}

function normalizeKey(key: string) {
  if (key === ",") return "comma"
  if (key === "+") return "plus"
  if (key === " ") return "space"
  return key.toLowerCase()
}

function recordKeybind(event: KeyboardEvent) {
  if (isModifier(event.key)) return

  const parts: string[] = []

  const mod = IS_MAC ? event.metaKey : event.ctrlKey
  if (mod) parts.push("mod")

  if (IS_MAC && event.ctrlKey) parts.push("ctrl")
  if (!IS_MAC && event.metaKey) parts.push("meta")
  if (event.altKey) parts.push("alt")
  if (event.shiftKey) parts.push("shift")

  const key = normalizeKey(event.key)
  if (!key) return
  parts.push(key)

  return parts.join("+")
}

function signatures(config: string | undefined) {
  if (!config) return []
  const sigs: string[] = []

  for (const kb of parseKeybind(config)) {
    const parts: string[] = []
    if (kb.ctrl) parts.push("ctrl")
    if (kb.alt) parts.push("alt")
    if (kb.shift) parts.push("shift")
    if (kb.meta) parts.push("meta")
    if (kb.key) parts.push(kb.key)
    if (parts.length === 0) continue
    sigs.push(parts.join("+"))
  }

  return sigs
}

export const SettingsKeybinds: Component = () => {
  const command = useCommand()
  const settings = useSettings()

  const [active, setActive] = createSignal<string | null>(null)

  const stop = () => {
    if (!active()) return
    setActive(null)
    command.keybinds(true)
  }

  const start = (id: string) => {
    if (active() === id) {
      stop()
      return
    }

    if (active()) stop()

    setActive(id)
    command.keybinds(false)
  }

  const hasOverrides = createMemo(() => {
    const keybinds = settings.current.keybinds as Record<string, string | undefined> | undefined
    if (!keybinds) return false
    return Object.values(keybinds).some((x) => typeof x === "string")
  })

  const resetAll = () => {
    stop()
    settings.keybinds.resetAll()
    showToast({ title: "Shortcuts reset", description: "Keyboard shortcuts have been reset to defaults." })
  }

  const list = createMemo(() => {
    const out = new Map<string, KeybindMeta>()
    out.set(PALETTE_ID, { title: "Command palette", group: "General" })

    for (const opt of command.catalog) {
      if (opt.id.startsWith("suggested.")) continue
      out.set(opt.id, { title: opt.title, group: groupFor(opt.id) })
    }

    for (const opt of command.options) {
      if (opt.id.startsWith("suggested.")) continue
      out.set(opt.id, { title: opt.title, group: groupFor(opt.id) })
    }

    const keybinds = settings.current.keybinds as Record<string, string | undefined> | undefined
    if (keybinds) {
      for (const [id, value] of Object.entries(keybinds)) {
        if (typeof value !== "string") continue
        if (out.has(id)) continue
        out.set(id, { title: id, group: groupFor(id) })
      }
    }

    return out
  })

  const title = (id: string) => list().get(id)?.title ?? ""

  const grouped = createMemo(() => {
    const map = list()
    const out = new Map<KeybindGroup, string[]>()

    for (const group of GROUPS) out.set(group, [])

    for (const [id, item] of map) {
      const ids = out.get(item.group)
      if (!ids) continue
      ids.push(id)
    }

    for (const group of GROUPS) {
      const ids = out.get(group)
      if (!ids) continue

      ids.sort((a, b) => {
        const at = map.get(a)?.title ?? ""
        const bt = map.get(b)?.title ?? ""
        return at.localeCompare(bt)
      })
    }

    return out
  })

  const used = createMemo(() => {
    const map = new Map<string, { id: string; title: string }[]>()

    const add = (key: string, value: { id: string; title: string }) => {
      const list = map.get(key)
      if (!list) {
        map.set(key, [value])
        return
      }
      list.push(value)
    }

    const palette = settings.keybinds.get(PALETTE_ID) ?? DEFAULT_PALETTE_KEYBIND
    for (const sig of signatures(palette)) {
      add(sig, { id: PALETTE_ID, title: "Command palette" })
    }

    const valueFor = (id: string) => {
      const custom = settings.keybinds.get(id)
      if (typeof custom === "string") return custom

      const live = command.options.find((x) => x.id === id)
      if (live?.keybind) return live.keybind

      const meta = command.catalog.find((x) => x.id === id)
      return meta?.keybind
    }

    for (const id of list().keys()) {
      if (id === PALETTE_ID) continue
      for (const sig of signatures(valueFor(id))) {
        add(sig, { id, title: title(id) })
      }
    }

    return map
  })

  const setKeybind = (id: string, keybind: string) => {
    settings.keybinds.set(id, keybind)
  }

  onMount(() => {
    const handle = (event: KeyboardEvent) => {
      const id = active()
      if (!id) return

      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()

      if (event.key === "Escape") {
        stop()
        return
      }

      const clear =
        (event.key === "Backspace" || event.key === "Delete") &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !event.shiftKey
      if (clear) {
        setKeybind(id, "none")
        stop()
        return
      }

      const next = recordKeybind(event)
      if (!next) return

      const map = used()
      const conflicts = new Map<string, string>()

      for (const sig of signatures(next)) {
        const list = map.get(sig) ?? []
        for (const item of list) {
          if (item.id === id) continue
          conflicts.set(item.id, item.title)
        }
      }

      if (conflicts.size > 0) {
        showToast({
          title: "Shortcut already in use",
          description: `${formatKeybind(next)} is already assigned to ${[...conflicts.values()].join(", ")}.`,
        })
        return
      }

      setKeybind(id, next)
      stop()
    }

    document.addEventListener("keydown", handle, true)
    onCleanup(() => {
      document.removeEventListener("keydown", handle, true)
    })
  })

  onCleanup(() => {
    if (active()) command.keybinds(true)
  })

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar">
      <div class="sticky top-0 z-10 bg-background-base border-b border-border-weak-base">
        <div class="flex items-start justify-between gap-4 p-8 max-w-[720px]">
          <div class="flex flex-col gap-1">
            <h2 class="text-16-medium text-text-strong">Keyboard shortcuts</h2>
            <p class="text-14-regular text-text-weak">Click a shortcut to edit. Press Esc to cancel.</p>
          </div>
          <Button size="small" variant="secondary" onClick={resetAll} disabled={!hasOverrides()}>
            Reset to defaults
          </Button>
        </div>
      </div>

      <div class="flex flex-col gap-6 p-8 pt-6 max-w-[720px]">
        <For each={GROUPS}>
          {(group) => (
            <Show when={(grouped().get(group) ?? []).length > 0}>
              <div class="flex flex-col gap-2">
                <h3 class="text-14-medium text-text-strong">{group}</h3>
                <div class="border border-border-weak-base rounded-lg overflow-hidden">
                  <For each={grouped().get(group) ?? []}>
                    {(id) => (
                      <div class="flex items-center justify-between gap-4 px-4 py-3 border-b border-border-weak-base last:border-none">
                        <span class="text-14-regular text-text-strong">{title(id)}</span>
                        <button
                          type="button"
                          classList={{
                            "h-8 px-3 rounded-md text-12-regular border border-border-base": true,
                            "bg-surface-base text-text-subtle hover:bg-surface-raised-base-hover active:bg-surface-raised-base-active":
                              active() !== id,
                            "bg-surface-raised-stronger-non-alpha text-text-strong": active() === id,
                          }}
                          onClick={() => start(id)}
                        >
                          <Show when={active() === id} fallback={command.keybind(id) || "Unassigned"}>
                            Press keys
                          </Show>
                        </button>
                      </div>
                    )}
                  </For>
                </div>
              </div>
            </Show>
          )}
        </For>
      </div>
    </div>
  )
}
