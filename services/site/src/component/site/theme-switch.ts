// The footer's theme switch on the pages that never hydrate: the static pages (src/client/theme.ts)
// and the docs (src/docs/client.ts). Site (site.tsx) renders the same from its theme signal
// (ThemeCycle, themeColor). The choice is saved as `opencode-theme`, which both share; the inline
// theme script (preload-settings.ts themeScript) applied it before first paint.

export const themes = ["system", "light", "dark"] as const
export type Theme = (typeof themes)[number]

/**
 * Shows `theme` on the site root and the switch (its label, from `label`, and its icon), and colours
 * the browser bar and form controls for it. `bar` replaces the bar's colour while it is set.
 */
export function showTheme(site: HTMLElement, theme: Theme, label: (theme: Theme, next: Theme) => string, bar?: string) {
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
