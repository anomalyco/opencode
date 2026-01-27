import { Component, For, Show, createMemo, onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { TextField } from "@opencode-ai/ui/text-field"
import { showToast } from "@opencode-ai/ui/toast"
import fuzzysort from "fuzzysort"
import { formatKeybind, parseKeybind, useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"
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

type GroupKey =
  | "settings.shortcuts.group.general"
  | "settings.shortcuts.group.session"
  | "settings.shortcuts.group.navigation"
  | "settings.shortcuts.group.modelAndAgent"
  | "settings.shortcuts.group.terminal"
  | "settings.shortcuts.group.prompt"

const groupKey: Record<KeybindGroup, GroupKey> = {
  General: "settings.shortcuts.group.general",
  Session: "settings.shortcuts.group.session",
  Navigation: "settings.shortcuts.group.navigation",
  "Model and agent": "settings.shortcuts.group.modelAndAgent",
  Terminal: "settings.shortcuts.group.terminal",
  Prompt: "settings.shortcuts.group.prompt",
}

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
  const language = useLanguage()
  const settings = useSettings()

  const [store, setStore] = createStore({
    active: null as string | null,
    filter: "",
  })

  const stop = () => {
    if (!store.active) return
    setStore("active", null)
    command.keybinds(true)
  }

  const start = (id: string) => {
    if (store.active === id) {
      stop()
      return
    }

    if (store.active) stop()

    setStore("active", id)
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
    showToast({
      title: language.t("settings.shortcuts.reset.toast.title"),
      description: language.t("settings.shortcuts.reset.toast.description"),
    })
  }

  const list = createMemo(() => {
    language.locale()
    const out = new Map<string, KeybindMeta>()
    out.set(PALETTE_ID, { title: language.t("command.palette"), group: "General" })

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

  const filtered = createMemo(() => {
    const query = store.filter.toLowerCase().trim()
    if (!query) return grouped()

    const map = list()
    const out = new Map<KeybindGroup, string[]>()

    for (const group of GROUPS) out.set(group, [])

    const items = Array.from(map.entries()).map(([id, meta]) => ({
      id,
      title: meta.title,
      group: meta.group,
      keybind: command.keybind(id) || "",
    }))

    const results = fuzzysort.go(query, items, {
      keys: ["title", "keybind"],
      threshold: -10000,
    })

    for (const result of results) {
      const item = result.obj
      const ids = out.get(item.group)
      if (!ids) continue
      ids.push(item.id)
    }

    return out
  })

  const hasResults = createMemo(() => {
    for (const group of GROUPS) {
      const ids = filtered().get(group) ?? []
      if (ids.length > 0) return true
    }
    return false
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
      add(sig, { id: PALETTE_ID, title: title(PALETTE_ID) })
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
      const id = store.active
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
          title: language.t("settings.shortcuts.conflict.title"),
          description: language.t("settings.shortcuts.conflict.description", {
            keybind: formatKeybind(next),
            titles: [...conflicts.values()].join(", "),
          }),
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
    if (store.active) command.keybinds(true)
  })

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-10 pb-10">
      <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-raised-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
        <div class="flex flex-col gap-4 pt-6 pb-6 max-w-[720px]">
          <div class="flex items-center justify-between gap-4">
            <h2 class="text-16-medium text-text-strong">{language.t("settings.shortcuts.title")}</h2>
            <Button size="small" variant="secondary" onClick={resetAll} disabled={!hasOverrides()}>
              {language.t("settings.shortcuts.reset.button")}
            </Button>
          </div>

          <div class="flex items-center gap-2 px-3 h-9 rounded-lg bg-surface-base">
            <Icon name="magnifying-glass" class="text-icon-weak-base flex-shrink-0" />
            <TextField
              variant="ghost"
              type="text"
              value={store.filter}
              onChange={(v) => setStore("filter", v)}
              placeholder={language.t("settings.shortcuts.search.placeholder")}
              spellcheck={false}
              autocorrect="off"
              autocomplete="off"
              autocapitalize="off"
              class="flex-1"
            />
            <Show when={store.filter}>
              <IconButton icon="circle-x" variant="ghost" onClick={() => setStore("filter", "")} />
            </Show>
          </div>
        </div>
      </div>

      <div class="flex flex-col gap-8 max-w-[720px]">
        <For each={GROUPS}>
          {(group) => (
            <Show when={(filtered().get(group) ?? []).length > 0}>
              <div class="flex flex-col gap-1">
                <h3 class="text-14-medium text-text-strong pb-2">{language.t(groupKey[group])}</h3>
                <div class="bg-surface-raised-base px-4 rounded-lg">
                  <For each={filtered().get(group) ?? []}>
                    {(id) => (
                      <div class="flex items-center justify-between gap-4 py-3 border-b border-border-weak-base last:border-none">
                        <span class="text-14-regular text-text-strong">{title(id)}</span>
                        <button
                          type="button"
                          classList={{
                            "h-8 px-3 rounded-md text-12-regular": true,
                            "bg-surface-base text-text-subtle hover:bg-surface-raised-base-hover active:bg-surface-raised-base-active":
                              store.active !== id,
                            "border border-border-weak-base bg-surface-inset-base text-text-weak": store.active === id,
                          }}
                          onClick={() => start(id)}
                        >
                          <Show
                            when={store.active === id}
                            fallback={command.keybind(id) || language.t("settings.shortcuts.unassigned")}
                          >
                            {language.t("settings.shortcuts.pressKeys")}
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

        <Show when={store.filter && !hasResults()}>
          <div class="flex flex-col items-center justify-center py-12 text-center">
            <span class="text-14-regular text-text-weak">{language.t("settings.shortcuts.search.empty")}</span>
            <Show when={store.filter}>
              <span class="text-14-regular text-text-strong mt-1">"{store.filter}"</span>
            </Show>
          </div>
        </Show>
      </div>
    </div>
  )
}
