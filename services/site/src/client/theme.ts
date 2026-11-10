import { $, $$, on, site, t, target } from "./dom"

// The footer's theme switch: system, light, dark, saved as `opencode-theme` (the docs share it). The
// inline script in the page (preload-settings.ts themeScript) applied the saved theme before first
// paint; this keeps the switch's label, the browser bar colour and form controls in step.

const themes = ["system", "light", "dark"] as const
type Theme = (typeof themes)[number]
const dark = matchMedia("(prefers-color-scheme: dark)")

/** The browser bar colour in a scheme: the "Like letters?" bar's blue while it fills the bottom. */
let barColor: string | undefined

export function startTheme() {
  show((site.dataset.theme as Theme | undefined) ?? "system")
  on("click", (event) => {
    if (!target(event).closest('[data-component="theme-toggle"] [data-slot="cycle"]')) return
    setTheme(themes[(themes.indexOf(site.dataset.theme as Theme) + 1) % 3])
  })
}

/** Shows and saves a theme (the switch, and search's "Toggle theme"). */
export function setTheme(theme: Theme) {
  localStorage.setItem("opencode-theme", theme)
  show(theme)
}

/** Whether the page shows the dark theme. */
export const isDark = () => site.dataset.theme === "dark" || (site.dataset.theme !== "light" && dark.matches)

/** Sets (or clears) the colour the browser bar takes over the theme's. */
export function setBarColor(color: string | undefined) {
  barColor = color
  show(site.dataset.theme as Theme)
}

function show(theme: Theme) {
  site.dataset.theme = theme
  const next = themes[(themes.indexOf(theme) + 1) % 3]
  $$('[data-component="theme-toggle"] [data-slot="cycle"]').forEach((cycle) => {
    cycle.setAttribute(
      "aria-label",
      t("site.theme.cycle", { theme: t(`site.theme.${theme}`), next: t(`site.theme.${next}`) }),
    )
    $$('[data-slot="icon"]', cycle).forEach((icon, index) =>
      icon.toggleAttribute("data-current", index === themes.indexOf(theme)),
    )
  })
  $$<HTMLMetaElement>('meta[name="theme-color"]').forEach(
    (meta) =>
      (meta.content =
        // #fbfbfb: Settings › Light background as production renders it (settings-defaults.json).
        barColor ?? (theme === "dark" || (theme === "system" && meta.media.includes("dark")) ? "#0c0c0c" : "#fbfbfb")),
  )
  const scheme = $<HTMLMetaElement>('meta[name="color-scheme"]')
  if (scheme) scheme.content = theme === "system" ? "light dark" : theme
}
