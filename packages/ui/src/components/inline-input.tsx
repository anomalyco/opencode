import type { ComponentProps } from "solid-js"
import { splitProps } from "solid-js"

export type InlineInputProps = ComponentProps<"input"> & {
  width?: string
}

export function InlineInput(props: InlineInputProps) {
  const [local, others] = splitProps(props, ["class", "width"])
  return <input data-component="inline-input" class={local.class} style={{ width: local.width }} {...others} />
}
