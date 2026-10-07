import { type ComponentProps } from "solid-js"
import { LoadingIndicator } from "../../components/loading-indicator"
import "./loader-v2.css"

export function LoaderV2(props: ComponentProps<"svg">) {
  return <LoadingIndicator {...props} data-component="loader-v2" />
}
