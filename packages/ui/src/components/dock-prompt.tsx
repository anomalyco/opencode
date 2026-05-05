import type { JSX } from "solid-js"
import { DockShell, DockTray } from "./dock-surface"

export function DockPrompt(props: {
  kind: "question" | "permission"
  header: JSX.Element
  children: JSX.Element
  footer: JSX.Element
  ref?: (el: HTMLDivElement) => void
  onKeyDown?: JSX.EventHandlerUnion<HTMLDivElement, KeyboardEvent>
}) {
  const slot = (name: string) => `${props.kind}-${name}`

  return (
    <div data-component="dock-prompt" data-kind={props.kind} ref={props.ref} onKeyDown={props.onKeyDown}>
      <DockShell data-slot={slot("body")}>
        <div data-slot={slot("header")}>{props.header}</div>
        <div data-slot={slot("content")}>{props.children}</div>
      </DockShell>
      <DockTray data-slot={slot("footer")}>{props.footer}</DockTray>
    </div>
  )
}
