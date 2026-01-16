import { createMemo, createSignal, onCleanup, onMount, type Accessor } from "solid-js"
import { createSimpleContext } from "@opencode-ai/ui/context"

const IS_MAC = typeof navigator === "object" && /(Mac|iPod|iPhone|iPad)/.test(navigator.platform)

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
  const eventKey = event.key.toLowerCase()

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
    const displayKey = kb.key.length === 1 ? kb.key.toUpperCase() : kb.key.charAt(0).toUpperCase() + kb.key.slice(1)
    parts.push(displayKey)
  }

  return IS_MAC ? parts.join("") : parts.join("+")
}

export const { use: useCommand, provider: CommandProvider } = createSimpleContext({
  name: "Command",
  init: () => {
    const [registrations, setRegistrations] = createSignal<Accessor<CommandOption[]>[]>([])
    const [suspendCount, setSuspendCount] = createSignal(0)

    const options = createMemo(() => {
      const seen = new Set<string>()
      const all: CommandOption[] = []

      for (const reg of registrations()) {
        for (const opt of reg()) {
          if (seen.has(opt.id)) continue
          seen.add(opt.id)
          all.push(opt)
        }
      }

      const suggested = all.filter((x) => x.suggested && !x.disabled)

      return [
        ...suggested.map((x) => ({
          ...x,
          id: "suggested." + x.id,
          category: "Suggested",
        })),
        ...all,
      ]
    })

    const suspended = () => suspendCount() > 0

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
      if (suspended()) return

      const paletteKeybinds = parseKeybind("mod+shift+p")
      if (matchKeybind(paletteKeybinds, event)) {
        event.preventDefault()
        showPalette()
        return
      }

      for (const option of options()) {
        if (option.disabled) continue
        if (!option.keybind) continue

        const keybinds = parseKeybind(option.keybind)
        if (matchKeybind(keybinds, event)) {
          event.preventDefault()
          option.onSelect?.("keybind")
          return
        }
      }
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
        setRegistrations((arr) => [results, ...arr])
        onCleanup(() => {
          setRegistrations((arr) => arr.filter((x) => x !== results))
        })
      },
      trigger(id: string, source?: "palette" | "keybind" | "slash") {
        run(id, source)
      },
      keybind(id: string) {
        const option = options().find((x) => x.id === id || x.id === "suggested." + id)
        if (!option?.keybind) return ""
        return formatKeybind(option.keybind)
      },
      show: showPalette,
      keybinds(enabled: boolean) {
        setSuspendCount((count) => count + (enabled ? -1 : 1))
      },
      suspended,
      get options() {
        return options()
      },
    }
  },
})
