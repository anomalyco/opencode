import { For } from "solid-js"
import { useI18n } from "~/context/i18n"
import { ThemeIcon, themes } from "./icons"

// Small pieces of the site's chrome that need no router or settings, so pages that render on the
// server and never hydrate (the docs) use them too.

/** "[ ]" with a dash that appears on hover or for the current item, as in the footer list. */
export function Bracket() {
  return (
    <span data-slot="box" aria-hidden="true">
      [<span data-slot="fill" />]
    </span>
  )
}

/** One button showing the current theme; each click moves to the next (system, light, dark). */
export function ThemeCycle(props: {
  theme: (typeof themes)[number]
  onChange: (theme: (typeof themes)[number]) => void
}) {
  const i18n = useI18n()
  const next = () => themes[(themes.indexOf(props.theme) + 1) % themes.length]
  return (
    <button
      type="button"
      data-slot="cycle"
      aria-label={i18n.t("site.theme.cycle", {
        theme: i18n.t(`site.theme.${props.theme}`),
        next: i18n.t(`site.theme.${next()}`),
      })}
      onClick={() => props.onChange(next())}
    >
      {/* All three icons stay in place so the change can cross-fade. */}
      <For each={themes}>
        {(item) => (
          <span data-slot="icon" data-current={props.theme === item ? "" : undefined}>
            <ThemeIcon theme={item} />
          </span>
        )}
      </For>
    </button>
  )
}

// A face (eyes and a smile, no outline) on the 16px icon grid, shown in the Markdown view.
export function PersonIcon() {
  // Drawn about 2px larger than the 16px grid in the same 14px box, to match the robot's ink (the
  // face alone is smaller than the robot's head and ears); the stroke is thinned to stay 1.1px.
  return (
    <svg
      width="14"
      height="14"
      viewBox="1.45 1.3 13.1 13.1"
      fill="none"
      stroke="currentColor"
      stroke-width="1.02"
      aria-hidden="true"
    >
      <rect x="4.5" y="3.5" width="2" height="4" fill="currentColor" stroke="none" />
      <rect x="9.5" y="3.5" width="2" height="4" fill="currentColor" stroke="none" />
      <path d="M3.25 9.25Q8 14 12.75 9.25" />
    </svg>
  )
}

// A robot face on the 16px icon grid, drawn like the theme icons.
export function AgentIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.25"
      aria-hidden="true"
    >
      <rect x="2.125" y="2.125" width="11.75" height="11.75" />
      <path d="M0.875 6V10M15.125 6V10" />
      <rect x="4.875" y="5.75" width="2" height="4.5" fill="currentColor" stroke="none" />
      <rect x="9.125" y="5.75" width="2" height="4.5" fill="currentColor" stroke="none" />
    </svg>
  )
}
