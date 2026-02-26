import type { JSX } from "solid-js"
import { DockShell, DockTray } from "./dock-surface"

export function DockPrompt(props: {
  kind: "question" | "permission"
  variant?: "default" | "transition"
  header: JSX.Element
  children: JSX.Element
  footer: JSX.Element
  ref?: (el: HTMLDivElement) => void
}) {
  const slot = (name: string) => `${props.kind}-${name}`

  return (
    <div data-component="dock-prompt" data-kind={props.kind} data-variant={props.variant ?? "default"} ref={props.ref}>
      <DockShell data-slot={slot("body")}>
        <div data-slot={slot("header")}>{props.header}</div>
        <div data-slot={slot("content")}>{props.children}</div>
      </DockShell>
      <DockTray data-slot={slot("footer")}>{props.footer}</DockTray>
    </div>
  )
}
