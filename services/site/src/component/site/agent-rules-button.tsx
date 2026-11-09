import "./agent-rules-button.css"
import { createSignal, onCleanup } from "solid-js"
import { designCopy } from "./design-copy"
import { siteSettings } from "./settings"

/**
 * The button that copies the Brand page's rules as Markdown for an agent (Brand and Press). Its label
 * comes from Design mode (brand.agentButton). Once copied, Settings › Agent button copied either keeps
 * the label and turns the copy icon into a check, or shows `copied`. Both labels share one grid cell,
 * so the width never changes; screen readers hear "Copied".
 */
export function AgentRulesButton(props: { label: string; copied: string; source: () => string }) {
  const [done, setDone] = createSignal(false)
  const timer = { id: 0 }
  onCleanup(() => clearTimeout(timer.id))
  const label = () => designCopy("brand.agentButton", props.label)
  const text = () => siteSettings.agentButtonCopied === "copied text"
  return (
    <button
      type="button"
      data-component="site-button"
      data-slot="agent-rules"
      data-funnel-copy="agent-rules"
      data-variant="neutral"
      data-design="agentButtonCopied"
      data-design-copy="brand.agentButton"
      data-copied={done() ? "" : undefined}
      onClick={() => {
        void navigator.clipboard.writeText(props.source())
        setDone(true)
        clearTimeout(timer.id)
        timer.id = window.setTimeout(() => setDone(false), 1500)
      }}
    >
      <span data-slot="labels" aria-hidden="true">
        <span data-active={done() && text() ? undefined : ""}>{label()}</span>
        <span data-active={done() && text() ? "" : undefined}>{props.copied}</span>
      </span>
      <span data-slot="sr-only">{label()}</span>
      <svg data-slot="icon" width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path
          d={done() ? "M4 10.5L8 14.5L16 5.5" : "M7.5 7.5V3.75H16.25V12.5H12.5M3.75 7.5H12.5V16.25H3.75V7.5Z"}
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap={done() ? "square" : undefined}
        />
      </svg>
      <span data-slot="sr-only" aria-live="polite">
        {done() ? "Copied" : ""}
      </span>
    </button>
  )
}
