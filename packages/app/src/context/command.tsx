import { createEffect, createMemo, onCleanup, onMount, type Accessor } from "solid-js"
import { createStore } from "solid-js/store"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useLanguage } from "@/context/language"
import { useSettings } from "@/context/settings"
import { Persist, persisted } from "@/utils/persist"

const IS_MAC = typeof navigator === "object" && /(Mac|iPod|iPhone|iPad)/.test(navigator.platform)

const PALETTE_ID = "command.palette"
const DEFAULT_PALETTE_KEYBIND = "mod+shift+p"
const SUGGESTED_PREFIX = "suggested."

function actionId(id: string) {
  if (!id.startsWith(SUGGESTED_PREFIX)) return id
  return id.slice(SUGGESTED_PREFIX.length)
}

function normalizeKey(key: string) {
  if (key === ",") return "comma"
  if (key === "+") return "plus"
  if (key === " ") return "space"
  return key.toLowerCase()
}

function signature(key: string, ctrl: boolean, meta: boolean, shift: boolean, alt: boolean) {
  const mask = (ctrl ? 1 : 0) | (meta ? 2 : 0) | (shift ? 4 : 0) | (alt ? 8 : 0)
  return `${key}:${mask}`
}

function signatureFromEvent(event: KeyboardEvent) {
  return signature(normalizeKey(event.key), event.ctrlKey, event.metaKey, event.shiftKey, event.altKey)
}

export type KeybindConfig = string

export interface Keybind {
  key: string
  ctrl: boolean
  meta: boolean
  shift: boolean
  alt: boolean
}

export interface CommandOption {
  id: string
  title: string
  description?: string
  category?: string
  keybind?: KeybindConfig
  slash?: string
  suggested?: boolean
  disabled?: boolean
  onSelect?: (source?: "palette" | "keybind" | "slash") => void
  onHighlight?: () => (() => void) | void
}

export type CommandCatalogItem = {
  title: string
  description?: string
  category?: string
  keybind?: KeybindConfig
  slash?: string
}

export function parseKeybind(config: string): Keybind[] {
  if (!config || config === "none") return []

  return config.split(",").map((combo) => {
    const parts = combo.trim().toLowerCase().split("+")
    const keybind: Keybind = {
      key: "",
      ctrl: false,
      meta: false,
      shift: false,
      alt: false,
    }

    for (const part of parts) {
      switch (part) {
        case "ctrl":
        case "control":
          keybind.ctrl = true
          break
        case "meta":
        case "cmd":
        case "command":
          keybind.meta = true
          break
        case "mod":
          if (IS_MAC) keybind.meta = true
          else keybind.ctrl = true
          break
        case "alt":
        case "option":
          keybind.alt = true
          break
        case "shift":
          keybind.shift = true
          break
        default:
          keybind.key = part
          break
      }
    }

    return keybind
  })
}

export function matchKeybind(keybinds: Keybind[], event: KeyboardEvent): boolean {
  const eventKey = normalizeKey(event.key)

  for (const kb of keybinds) {
    const keyMatch = kb.key === eventKey
    const ctrlMatch = kb.ctrl === (event.ctrlKey || false)
    const metaMatch = kb.meta === (event.metaKey || false)
    const shiftMatch = kb.shift === (event.shiftKey || false)
    const altMatch = kb.alt === (event.altKey || false)

    if (keyMatch && ctrlMatch && metaMatch && shiftMatch && altMatch) {
      return true
    }
  }

  return false
}

export function formatKeybind(config: string): string {
  if (!config || config === "none") return ""

  const keybinds = parseKeybind(config)
  if (keybinds.length === 0) return ""

  const kb = keybinds[0]
  const parts: string[] = []

  if (kb.ctrl) parts.push(IS_MAC ? "⌃" : "Ctrl")
  if (kb.alt) parts.push(IS_MAC ? "⌥" : "Alt")
  if (kb.shift) parts.push(IS_MAC ? "⇧" : "Shift")
  if (kb.meta) parts.push(IS_MAC ? "⌘" : "Meta")

  if (kb.key) {
    const keys: Record<string, string> = {
      arrowup: "↑",
      arrowdown: "↓",
      arrowleft: "←",
      arrowright: "→",
      comma: ",",
      plus: "+",
      space: "Space",
    }
    const key = kb.key.toLowerCase()
    const displayKey = keys[key] ?? (key.length === 1 ? key.toUpperCase() : key.charAt(0).toUpperCase() + key.slice(1))
    parts.push(displayKey)
  }

  return IS_MAC ? parts.join("") : parts.join("+")
}

export const { use: useCommand, provider: CommandProvider } = createSimpleContext({
  name: "Command",
  init: () => {
    const dialog = useDialog()
    const settings = useSettings()
    const language = useLanguage()
    const [store, setStore] = createStore({
      registrations: [] as Accessor<CommandOption[]>[],
      suspendCount: 0,
    })

    const [catalog, setCatalog, _, catalogReady] = persisted(
      Persist.global("command.catalog.v1"),
      createStore<Record<string, CommandCatalogItem>>({}),
    )

    const bind = (id: string, def: KeybindConfig | undefined) => {
      const custom = settings.keybinds.get(actionId(id))
      const config = custom ?? def
      if (!config || config === "none") return
      return config
    }

    const registered = createMemo(() => {
      const seen = new Set<string>()
      const all: CommandOption[] = []

      for (const reg of store.registrations) {
        for (const opt of reg()) {
          if (seen.has(opt.id)) continue
          seen.add(opt.id)
          all.push(opt)
        }
      }

      return all
    })

    createEffect(() => {
      if (!catalogReady()) return

      for (const opt of registered()) {
        const id = actionId(opt.id)
        setCatalog(id, {
          title: opt.title,
          description: opt.description,
          category: opt.category,
          keybind: opt.keybind,
          slash: opt.slash,
        })
      }
    })

    const catalogOptions = createMemo(() => Object.entries(catalog).map(([id, meta]) => ({ id, ...meta })))

    const options = createMemo(() => {
      const resolved = registered().map((opt) => ({
        ...opt,
        keybind: bind(opt.id, opt.keybind),
      }))

      const suggested = resolved.filter((x) => x.suggested && !x.disabled)

      return [
        ...suggested.map((x) => ({
          ...x,
          id: SUGGESTED_PREFIX + x.id,
          category: language.t("command.category.suggested"),
        })),
        ...resolved,
      ]
    })

    const suspended = () => store.suspendCount > 0

    const palette = createMemo(() => {
      const config = settings.keybinds.get(PALETTE_ID) ?? DEFAULT_PALETTE_KEYBIND
      const keybinds = parseKeybind(config)
      return new Set(keybinds.map((kb) => signature(kb.key, kb.ctrl, kb.meta, kb.shift, kb.alt)))
    })

    const keymap = createMemo(() => {
      const map = new Map<string, CommandOption>()
      for (const option of options()) {
        if (option.id.startsWith(SUGGESTED_PREFIX)) continue
        if (option.disabled) continue
        if (!option.keybind) continue

        const keybinds = parseKeybind(option.keybind)
        for (const kb of keybinds) {
          if (!kb.key) continue
          const sig = signature(kb.key, kb.ctrl, kb.meta, kb.shift, kb.alt)
          if (map.has(sig)) continue
          map.set(sig, option)
        }
      }
      return map
    })

    const run = (id: string, source?: "palette" | "keybind" | "slash") => {
      for (const option of options()) {
        if (option.id === id || option.id === "suggested." + id) {
          option.onSelect?.(source)
          return
        }
      }
    }

    const showPalette = () => {
      run("file.open", "palette")
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (suspended() || dialog.active) return

      const sig = signatureFromEvent(event)

      if (palette().has(sig)) {
        event.preventDefault()
        showPalette()
        return
      }

      const option = keymap().get(sig)
      if (!option) return
      event.preventDefault()
      option.onSelect?.("keybind")
    }

    onMount(() => {
      document.addEventListener("keydown", handleKeyDown)
    })

    onCleanup(() => {
      document.removeEventListener("keydown", handleKeyDown)
    })

    return {
      register(cb: () => CommandOption[]) {
        const results = createMemo(cb)
        setStore("registrations", (arr) => [results, ...arr])
        onCleanup(() => {
          setStore("registrations", (arr) => arr.filter((x) => x !== results))
        })
      },
      trigger(id: string, source?: "palette" | "keybind" | "slash") {
        run(id, source)
      },
      keybind(id: string) {
        if (id === PALETTE_ID) {
          return formatKeybind(settings.keybinds.get(PALETTE_ID) ?? DEFAULT_PALETTE_KEYBIND)
        }

        const base = actionId(id)
        const option = options().find((x) => actionId(x.id) === base)
        if (option?.keybind) return formatKeybind(option.keybind)

        const meta = catalog[base]
        const config = bind(base, meta?.keybind)
        if (!config) return ""
        return formatKeybind(config)
      },
      show: showPalette,
      keybinds(enabled: boolean) {
        setStore("suspendCount", (count) => count + (enabled ? -1 : 1))
      },
      suspended,
      get catalog() {
        return catalogOptions()
      },
      get options() {
        return options()
      },
    }
  },
})
