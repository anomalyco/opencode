import { splitProps, type ComponentProps } from "solid-js"
import { Icon } from "./icon"
import { installLineCommentStyles } from "./line-comment-styles"

installLineCommentStyles()

export function ContextAddButton(props: ComponentProps<"button"> & { label: string }) {
  const [local, rest] = splitProps(props, ["label", "class", "children"])
  return (
    <button
      type="button"
      data-component="context-add-button"
      aria-label={local.label}
      class={local.class}
      {...rest}
    >
      <Icon name="plus-small" size="small" />
    </button>
  )
}
