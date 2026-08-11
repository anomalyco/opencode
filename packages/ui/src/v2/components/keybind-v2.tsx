import { type ComponentProps, For, splitProps } from "solid-js"
import "./keybind-v2.css"

export interface KeybindV2Props extends ComponentProps<"div"> {
  keys: string[]
  variant?: "neutral" | "ghost"
}

export function KeybindV2(props: KeybindV2Props) {
  const [local, rest] = splitProps(props, ["keys", "variant", "class", "classList"])
  return (
    <div
      {...rest}
      data-component="keybind-v2"
      data-variant={local.variant || "neutral"}
      classList={{
        ...local.classList,
        [local.class ?? ""]: !!local.class,
      }}
    >
      <For each={local.keys}>
        {(key) => (
          <div data-slot="keybind-v2-key">
            <span data-slot="keybind-v2-label">{key}</span>
          </div>
        )}
      </For>
    </div>
  )
}
