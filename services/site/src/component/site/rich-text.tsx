import { For } from "solid-js"
import type { RichText } from "~/lib/markdown"

/** Renders shared page copy: text runs, inline code and links. */
export function Rich(props: { value: RichText }) {
  return (
    <For each={props.value}>
      {(item) => {
        if (typeof item === "string") return item
        if ("code" in item) return <code>{item.code}</code>
        return (
          <a href={item.href} target={item.external ? "_blank" : undefined}>
            {item.text}
          </a>
        )
      }}
    </For>
  )
}
