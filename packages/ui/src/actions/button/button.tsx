import type { Root } from "@kobalte/core/button"
import { type ComponentProps, Show, splitProps } from "solid-js"
import { Icon, type IconProps } from "@opencode/ui/icon"
import "./button.css"

export interface ButtonProps
  extends Omit<ComponentProps<typeof Root>, "type">,
    Pick<ComponentProps<"button">, "class" | "classList" | "children" | "type"> {
  size?: "small" | "normal" | "large"
  variant?:
    | "neutral"
    | "danger"
    | "warning"
    | "outline"
    | "contrast"
    | "submit"
    | "ghost"
    | "ghost-muted"
    | "ghost-faint"
    | "ghost-danger"
    | "loading"
  icon?: IconProps["name"]
}

// A native button with the attributes Kobalte's Button sets on one, without its per-instance computations.
export function Button(props: ButtonProps) {
  const [split, rest] = splitProps(props, ["variant", "size", "icon", "class", "classList", "disabled"])

  return (
    <button
      // A type the caller passes in `rest` replaces this default.
      type="button"
      disabled={split.disabled}
      data-disabled={split.disabled ? "" : undefined}
      {...rest}
      data-component="button-v2"
      data-size={split.size || "normal"}
      data-variant={split.variant || "neutral"}
      data-icon={split.icon}
      classList={{
        ...split.classList,
        [split.class ?? ""]: !!split.class,
      }}
    >
      <Show when={split.icon}>{(icon) => <Icon name={icon()} />}</Show>
      {props.children}
    </button>
  )
}
