import { createMemo, createSignal } from "solid-js"
import { useConfig } from "../config"
import { useTheme } from "../context/theme"
import { DialogSelect } from "../ui/dialog-select"
import { useToast } from "../ui/toast"

type Setting = {
  title: string
  category: string
  path: string[]
  default: unknown
  values?: readonly unknown[]
  labels?: readonly string[]
  step?: number
  min?: number
  max?: number
  format?: (value: unknown) => string
}

const settings: Setting[] = [
  {
    title: "Theme",
    category: "Appearance",
    path: ["theme", "name"],
    default: "opencode",
  },
  {
    title: "Color mode",
    category: "Appearance",
    path: ["theme", "mode"],
    default: "system",
    values: ["system", "dark", "light"],
  },
  {
    title: "Animations",
    category: "Appearance",
    path: ["animations"],
    default: true,
    values: [false, true],
    labels: ["off", "on"],
  },
  {
    title: "Onboarding",
    category: "Appearance",
    path: ["hints", "onboarding"],
    default: true,
    values: [false, true],
    labels: ["off", "on"],
  },
  {
    title: "Sidebar",
    category: "Session",
    path: ["session", "sidebar"],
    default: "auto",
    values: ["hide", "auto"],
  },
  {
    title: "Scrollbar",
    category: "Session",
    path: ["session", "scrollbar"],
    default: false,
    values: [false, true],
    labels: ["off", "on"],
  },
  {
    title: "Thinking",
    category: "Session",
    path: ["session", "thinking"],
    default: "hide",
    values: ["hide", "show"],
  },
  {
    title: "Markdown",
    category: "Session",
    path: ["session", "markdown"],
    default: "rendered",
    values: ["source", "rendered"],
  },
  {
    title: "Grouping",
    category: "Session",
    path: ["session", "grouping"],
    default: "auto",
    values: ["none", "auto"],
  },
  {
    title: "Layout",
    category: "Diffs",
    path: ["diffs", "view"],
    default: "auto",
    values: ["auto", "split", "unified"],
  },
  {
    title: "Wrapping",
    category: "Diffs",
    path: ["diffs", "wrap"],
    default: "word",
    values: ["none", "word"],
  },
  {
    title: "File tree",
    category: "Diffs",
    path: ["diffs", "tree"],
    default: true,
    values: [false, true],
    labels: ["off", "on"],
  },
  {
    title: "Single patch",
    category: "Diffs",
    path: ["diffs", "single"],
    default: false,
    values: [false, true],
    labels: ["off", "on"],
  },
  {
    title: "Scroll speed",
    category: "Input",
    path: ["scroll", "speed"],
    default: 3,
    step: 0.25,
    min: 0.25,
    max: 10,
    format: (value) => Number(value).toFixed(2),
  },
  {
    title: "Acceleration",
    category: "Input",
    path: ["scroll", "acceleration"],
    default: false,
    values: [false, true],
    labels: ["off", "on"],
  },
  {
    title: "Mouse",
    category: "Input",
    path: ["mouse"],
    default: true,
    values: [false, true],
    labels: ["off", "on"],
  },
  {
    title: "Editor context",
    category: "Input",
    path: ["prompt", "editor"],
    default: true,
    values: [false, true],
    labels: ["off", "on"],
  },
  {
    title: "Large pastes",
    category: "Input",
    path: ["prompt", "paste"],
    default: "compact",
    values: ["compact", "full"],
  },
  {
    title: "Leader timeout",
    category: "Input",
    path: ["leader", "timeout"],
    default: 2000,
    step: 250,
    min: 250,
    max: 10000,
    format: (value) => `${value} ms`,
  },
  {
    title: "Attention",
    category: "Alerts",
    path: ["attention", "enabled"],
    default: false,
    values: [false, true],
    labels: ["off", "on"],
  },
  {
    title: "Notifications",
    category: "Alerts",
    path: ["attention", "notifications"],
    default: true,
    values: [false, true],
    labels: ["off", "on"],
  },
  {
    title: "Sounds",
    category: "Alerts",
    path: ["attention", "sound"],
    default: true,
    values: [false, true],
    labels: ["off", "on"],
  },
  {
    title: "Volume",
    category: "Alerts",
    path: ["attention", "volume"],
    default: 0.4,
    step: 0.1,
    min: 0,
    max: 1,
    format: (value) => `${Math.round(Number(value) * 100)}%`,
  },
  {
    title: "Window title",
    category: "Terminal",
    path: ["terminal", "title"],
    default: true,
    values: [false, true],
    labels: ["off", "on"],
  },
  {
    title: "DevTools",
    category: "Debug",
    path: ["debug", "devtools"],
    default: false,
    values: [false, true],
    labels: ["off", "on"],
  },
]

export function DialogConfig() {
  const config = useConfig()
  const toast = useToast()
  const themeState = useTheme()
  const [selected, setSelected] = createSignal(0)
  const [saving, setSaving] = createSignal(false)

  const value = (setting: Setting) => {
    const current = setting.path.reduce<unknown>((result, key) => {
      if (!result || typeof result !== "object") return undefined
      return (result as Record<string, unknown>)[key]
    }, config.data)
    if (setting.path.join(".") === "theme.name") return current ?? themeState.selected
    return current ?? setting.default
  }
  const values = (setting: Setting) =>
    setting.path.join(".") === "theme.name"
      ? Object.keys(themeState.all()).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
      : setting.values
  const display = (setting: Setting) => {
    const current = value(setting)
    if (setting.format) return setting.format(current)
    const index = setting.values?.indexOf(current)
    return index === undefined || index < 0 ? String(current) : (setting.labels?.[index] ?? String(current))
  }
  const options = createMemo(() =>
    settings.map((setting, index) => ({
      title: setting.title,
      category: setting.category,
      footer: display(setting),
      value: index,
    })),
  )

  async function change(direction: number, index = selected()) {
    if (saving()) return
    const setting = settings[index]
    const current = value(setting)
    const choices = values(setting)
    const next = choices
      ? choices[(choices.indexOf(current) + direction + choices.length) % choices.length]
      : Math.min(setting.max!, Math.max(setting.min!, Number(current) + direction * setting.step!))
    if (next === current) return
    setSaving(true)
    await config
      .update((draft) => {
        const parent = setting.path.slice(0, -1).reduce<Record<string, unknown>>((result, key) => {
          if (!result[key] || typeof result[key] !== "object") result[key] = {}
          return result[key] as Record<string, unknown>
        }, draft)
        parent[setting.path.at(-1)!] = next
      })
      .catch(toast.error)
      .finally(() => setSaving(false))
  }

  return (
    <DialogSelect
      title="Settings"
      options={options()}
      onMove={(option) => setSelected(option.value)}
      onSelect={(option) => void change(1, option.value)}
      footerHints={[{ title: "←/→", label: "change" }]}
      bindings={[
        {
          bind: "left",
          title: "Previous value",
          group: "Settings",
          run: () => void change(-1),
        },
        {
          bind: "right",
          title: "Next value",
          group: "Settings",
          run: () => void change(1),
        },
      ]}
    />
  )
}
