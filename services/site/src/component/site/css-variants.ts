import { defaultRootAttributes, defaultScopedAttributes } from "./preload-settings"
import { siteSettingsDefaults } from "./settings"

// Settings attributes whose value in production is fixed by the default settings. Left out: data-banner
// (the dismissable banner sets it at runtime) and data-popover (the theme switcher's popover state).
const runtime = new Set(["data-banner", "data-popover"])

/**
 * Each settings attribute and its production value: on the site root (`root`), and on the element
 * a pre-paint rule names (`scoped`, `[element, attribute, value]`). script/css-variants.ts writes
 * them to JSON.
 */
export function cssVariants() {
  const d = siteSettingsDefaults
  return {
    root: {
      ...Object.fromEntries(Object.entries(defaultRootAttributes()).filter(([name]) => !runtime.has(name))),
      // The home page's Console section (routes/index.tsx).
      "data-console-height": d.consoleHeight,
      "data-console-label": d.consoleLayout === "block" ? "left" : d.consoleLabel,
      "data-console-layout": d.consoleLayout,
    } as Record<string, string | null>,
    scoped: [
      ...defaultScopedAttributes().map((entry) => [...entry]),
      // Markup only the docs components gallery renders (/dev/docs-components: docs-code-gallery.tsx
      // and its blend comparison), which no production page shows: its own attribute is never there.
      ...[
        ["data-slot", "code-gallery"],
        ["data-slot", "gallery-item"],
        ["data-slot", "gallery-options"],
        ["data-slot", "gallery-steps"],
        ["data-slot", "gallery-table"],
        ["data-slot", "blend-plain"],
        ...["a", "b", "c", "d"].map((value) => ["data-blend", value]),
      ].map(([name, value]) => [`[${name}="${value}"]`, name, null]),
    ],
  }
}
