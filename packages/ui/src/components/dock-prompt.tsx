import { Show, createSignal, type JSX } from "solid-js"
import { Icon } from "./icon"
import { DockShell, DockTray } from "./dock-surface"

export function DockPrompt(props: {
  kind: "question" | "permission"
  header: JSX.Element
  children: JSX.Element
  footer: JSX.Element
  expandLabel?: string
  collapseLabel?: string
  ref?: (el: HTMLDivElement) => void
}) {
  const slot = (name: string) => `${props.kind}-${name}`
  const [collapsed, setCollapsed] = createSignal(false)
  const toggleLabel = () => (collapsed() ? props.expandLabel : props.collapseLabel)
  const fallbackLabel = () => (collapsed() ? "Expand" : "Collapse")

  return (
    <div data-component="dock-prompt" data-kind={props.kind} data-collapsed={collapsed()} ref={props.ref}>
      <DockShell data-slot={slot("body")}>
        <div data-slot={slot("header")}>
          {props.header}
          <button
            type="button"
            data-slot="question-collapse"
            data-label={toggleLabel() ? "true" : "false"}
            onClick={() => setCollapsed((v) => !v)}
            aria-expanded={!collapsed()}
            aria-label={toggleLabel() ?? fallbackLabel()}
          >
            <Icon name="chevron-grabber-vertical" size="small" />
            <Show when={toggleLabel()}>{(label) => <span data-slot="question-collapse-label">{label()}</span>}</Show>
          </button>
        </div>
        <Show when={!collapsed()}>
          <div data-slot={slot("content")}>{props.children}</div>
        </Show>
      </DockShell>
      <Show when={!collapsed()}>
        <DockTray data-slot={slot("footer")}>{props.footer}</DockTray>
      </Show>
    </div>
  )
}
