// The share card's options. Visitors set layout, size, style and motion in the share editor; Design mode, as on
// opencode.ai (services/site design-mode.tsx), adds blue controls above the preview that cycle every option,
// including the ones visitors don't get (`designOnly`). Ctrl+D turns it on under `vite dev` only.
import { createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import { defaultShareOptions, type ShareOptions } from "./card"

const modeKey = "opencode-data-design-mode"
const optionsKey = "opencode-data-share-options"

export const shareControls = [
  {
    key: "layout",
    label: "Layout",
    options: [
      ["headline", "Headline"],
      ["number", "Big number"],
      ["chart", "Chart"],
    ],
  },
  {
    key: "size",
    label: "Size",
    options: [
      ["4:5", "4:5"],
      ["1:1", "1:1"],
      ["9:16", "9:16"],
      ["16:9", "16:9"],
    ],
  },
  {
    key: "theme",
    label: "Theme",
    options: [
      ["dark", "Dark"],
      ["light", "Light"],
    ],
  },
  {
    key: "background",
    label: "Background",
    options: [
      ["dots", "Dots"],
      ["band", "Band"],
      ["plain", "Plain"],
    ],
  },
  {
    key: "logo",
    label: "Logo",
    options: [
      ["lockup", "DATA"],
      ["full", "OPENCODE DATA"],
    ],
  },
  {
    key: "motion",
    label: "Motion",
    options: [
      ["highlight", "Highlight each"],
      ["build", "Build only"],
    ],
  },
] as const satisfies readonly {
  key: keyof ShareOptions
  label: string
  options: readonly (readonly [string, string])[]
}[]

export const designOnly: readonly (keyof ShareOptions)[] = ["background", "logo"]

export const [designMode, setDesignModeState] = createSignal(false)
export const [shareOptions, setShareOptions] = createStore<ShareOptions>({ ...defaultShareOptions })

export function cycleShareOption(key: keyof ShareOptions, direction: 1 | -1) {
  const control = shareControls.find((item) => item.key === key)
  if (!control) return
  const values: readonly string[] = control.options.map((option) => option[0])
  const index = values.indexOf(shareOptions[key])
  setShareOption(key, values[(index + direction + values.length) % values.length] as ShareOptions[typeof key])
}

/** Sets one option. Under `vite dev` the choice is kept for the next visit, as Design mode's are. */
export function setShareOption<K extends keyof ShareOptions>(key: K, value: ShareOptions[K]) {
  setShareOptions(key, value as never)
  if (import.meta.env.DEV) localStorage.setItem(optionsKey, JSON.stringify(shareOptions))
}

/** Development only: restores Design mode and its choices, and listens for Ctrl+D. Returns the cleanup. */
export function installShareDesign() {
  if (localStorage.getItem(modeKey) === "1") setDesignModeState(true)
  const saved = readOptions(localStorage.getItem(optionsKey))
  if (saved) setShareOptions(saved)
  const key = (event: KeyboardEvent) => {
    if (event.key.toLowerCase() !== "d" || !event.ctrlKey || event.metaKey || event.altKey || event.repeat) return
    if ((event.target as HTMLElement).closest("input, textarea, select, [contenteditable]")) return
    event.preventDefault()
    setDesignModeState(!designMode())
    localStorage.setItem(modeKey, designMode() ? "1" : "0")
  }
  document.addEventListener("keydown", key)
  return () => document.removeEventListener("keydown", key)
}

// localStorage can hold anything, including options an older build no longer has.
function readOptions(raw: string | null) {
  if (!raw) return undefined
  const parsed: unknown = (() => {
    try {
      return JSON.parse(raw)
    } catch {
      return undefined
    }
  })()
  if (!parsed || typeof parsed !== "object") return undefined
  return Object.fromEntries(
    shareControls.flatMap((control) => {
      const value = (parsed as Record<string, unknown>)[control.key]
      return control.options.some((option) => option[0] === value) ? [[control.key, value]] : []
    }),
  ) as Partial<ShareOptions>
}
