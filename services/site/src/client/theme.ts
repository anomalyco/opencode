import { showTheme, themes, type Theme } from "~/component/site/theme-switch"
import { on, site, t, target } from "./dom"

// The footer's theme switch: system, light, dark (theme-switch.ts), in step with the browser bar
// colour and form controls.

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
  showTheme(
    site,
    theme,
    (current, next) => t("site.theme.cycle", { theme: t(`site.theme.${current}`), next: t(`site.theme.${next}`) }),
    barColor,
  )
}
