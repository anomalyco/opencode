import { Button as Kobalte } from "@kobalte/core/button"
import { type ComponentProps, Show, createMemo, splitProps } from "solid-js"
import { Icon, type IconProps } from "./icon"
import "./button-v2.css"

export interface ButtonV2Props
  extends ComponentProps<typeof Kobalte>,
    Pick<ComponentProps<"button">, "class" | "classList" | "children"> {
  size?: "small" | "normal" | "large"
  variant?: "neutral" | "danger" | "warning" | "outline" | "contrast" | "ghost" | "ghost-muted" | "loading"
  icon?: IconProps["name"]
}

export function ButtonV2(props: ButtonV2Props) {
  const [split, rest] = splitProps(props, ["variant", "size", "icon", "class", "classList"])
  const resolvedIcon = createMemo(() => split.icon)
  return (
    <Kobalte
      {...rest}
      data-component="button-v2"
      data-size={split.size || "normal"}
      data-variant={split.variant || "neutral"}
      data-icon={resolvedIcon()}
      classList={{
        ...split.classList,
        [split.class ?? ""]: !!split.class,
      }}
    >
      <Show when={resolvedIcon()}>
        <Icon name={resolvedIcon()!} />
      </Show>
      {props.children}
    </Kobalte>
  )
}
