import { defaultRootAttributes } from "./preload-settings"
import { siteSettingsDefaults } from "./settings"

// Settings attributes whose value in production is fixed by the default settings. Left out: data-banner
// (the dismissable banner sets it at runtime) and data-popover (the theme switcher's popover state).
const runtime = new Set(["data-banner", "data-popover"])

/** Each settings attribute and its production value; script/css-variants.ts writes it to JSON. */
export function cssVariants() {
  const d = siteSettingsDefaults
  return {
    ...Object.fromEntries(Object.entries(defaultRootAttributes()).filter(([name]) => !runtime.has(name))),
    // The home page's Console section (routes/index.tsx).
    "data-console-height": d.consoleHeight,
    "data-console-label": d.consoleLayout === "block" ? "left" : d.consoleLabel,
    "data-console-layout": d.consoleLayout,
  } as Record<string, string | null>
}
