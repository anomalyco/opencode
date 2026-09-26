import { type ComponentProps, splitProps } from "solid-js"
import "./divider-v2.css"

export interface DividerV2Props extends ComponentProps<"div"> {}

export function DividerV2(props: DividerV2Props) {
  const [local, rest] = splitProps(props, ["class", "classList"])
  return (
    <div
      {...rest}
      role="separator"
      aria-orientation="horizontal"
      data-component="divider-v2"
      classList={{
        ...local.classList,
        [local.class ?? ""]: !!local.class,
      }}
    />
  )
}
