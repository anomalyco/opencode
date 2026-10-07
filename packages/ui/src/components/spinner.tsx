import { type ComponentProps } from "solid-js"
import { LoadingIndicator } from "./loading-indicator"

export function Spinner(props: {
  class?: string
  classList?: ComponentProps<"div">["classList"]
  style?: ComponentProps<"div">["style"]
}) {
  return <LoadingIndicator {...props} width={18} height={18} data-component="spinner" />
}
