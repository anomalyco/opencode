import { Show, createSignal, type JSX } from "solid-js"
import { Icon } from "./icon"
import { DockShell, DockTray } from "./dock-surface"

export function DockPrompt(props: {
  kind: "question" | "permission"
  header: JSX.Element
  children: JSX.Element
  footer: JSX.Element
  ref?: (el: HTMLDivElement) => void
}) {
  const slot = (name: string) => `${props.kind}-${name}`
  const [collapsed, setCollapsed] = createSignal(false)

  return (
    <div data-component="dock-prompt" data-kind={props.kind} data-collapsed={collapsed()} ref={props.ref}>
      <DockShell data-slot={slot("body")}>
        <div data-slot={slot("header")}>
          {props.header}
          <button
            type="button"
            data-slot="question-collapse"
            onClick={() => setCollapsed((v) => !v)}
            aria-expanded={!collapsed()}
            aria-label={collapsed() ? "Expand" : "Collapse"}
          >
            <Icon name="chevron-grabber-vertical" size="small" />
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
