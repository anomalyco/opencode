import { type ComponentProps, splitProps } from "solid-js"

export interface TagProps extends ComponentProps<"span"> {
  size?: "normal" | "large"
}

export function Tag(props: TagProps) {
  const [split, rest] = splitProps(props, ["size", "class", "classList", "children"])
  return (
    <span
      {...rest}
      data-component="tag"
      data-size={split.size || "normal"}
      classList={{
        ...(split.classList ?? {}),
        [split.class ?? ""]: !!split.class,
      }}
    >
      {split.children}
    </span>
  )
}
