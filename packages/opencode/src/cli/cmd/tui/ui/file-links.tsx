import { For } from "solid-js"
import type { RGBA } from "@opentui/core"

export function FileLinks(props: { parts: ({ href: string; label: string } | string)[]; fg: RGBA }) {
  return (
    <text fg={props.fg}>
      <For each={props.parts}>{(part) => (typeof part === "string" ? part : <a href={part.href}>{part.label}</a>)}</For>
    </text>
  )
}
