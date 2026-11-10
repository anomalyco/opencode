// The footer's theme switch on the pages that never hydrate: the static pages (src/client/theme.ts)
// and the docs (src/docs/client.ts). Site (site.tsx) renders the same from its theme signal
// (ThemeCycle, themeColor). The choice is saved as `opencode-theme`, which both share; the inline
// theme script (preload-settings.ts themeScript) applied it before first paint.

export const themes = ["system", "light", "dark"] as const
export type Theme = (typeof themes)[number]

/**
 * Runs the switch: shows the theme the page starts in, and a click on the switch shows and saves the
 * next one. `label` names the switch for the theme it shows and the one it goes to; `bar`, while it
 * gives a colour, replaces the browser bar's. Returns `show`, which shows a theme (by default the
 * current one) without saving it.
 */
export function startThemeSwitch(
  site: HTMLElement,
  label: (theme: Theme, next: Theme) => string,
  bar?: () => string | undefined,
) {
  const show = (theme = (site.dataset.theme as Theme | undefined) ?? "system") => showTheme(site, theme, label, bar?.())
  show()
  document.addEventListener("click", (event) => {
    if (!(event.target as Element).closest?.('[data-component="theme-toggle"] [data-slot="cycle"]')) return
    const next = themes[(themes.indexOf(site.dataset.theme as Theme) + 1) % 3]
    localStorage.setItem("opencode-theme", next)
    show(next)
  })
  return show
}

/**
 * Shows `theme` on the site root and the switch (its label, from `label`, and its icon), and colours
 * the browser bar and form controls for it. `bar` replaces the bar's colour while it is set.
 */
function showTheme(site: HTMLElement, theme: Theme, label: (theme: Theme, next: Theme) => string, bar?: string) {
  site.dataset.theme = theme
  const next = themes[(themes.indexOf(theme) + 1) % 3]
  document.querySelectorAll('[data-component="theme-toggle"] [data-slot="cycle"]').forEach((cycle) => {
    cycle.setAttribute("aria-label", label(theme, next))
    cycle
      .querySelectorAll('[data-slot="icon"]')
      .forEach((icon, index) => icon.toggleAttribute("data-current", index === themes.indexOf(theme)))
  })
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach(
    (meta) =>
      (meta.content =
        // #fbfbfb: Settings › Light background as production renders it (settings-defaults.json).
        bar ?? (theme === "dark" || (theme === "system" && meta.media.includes("dark")) ? "#0c0c0c" : "#fbfbfb")),
  )
  const scheme = document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]')
  if (scheme) scheme.content = theme === "system" ? "light dark" : theme
}
