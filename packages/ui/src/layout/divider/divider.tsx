import { type ComponentProps, splitProps } from "solid-js"
import "./divider.css"

export interface DividerProps extends ComponentProps<"div"> {}

export function Divider(props: DividerProps) {
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
