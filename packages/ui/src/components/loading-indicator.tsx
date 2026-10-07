import { type ComponentProps } from "solid-js"
import { TablerIcon } from "./tabler-icon"
import "./loading-indicator.css"

export function LoadingIndicator(props: ComponentProps<"svg"> & { "data-component"?: string }) {
  return (
    <TablerIcon
      width={16}
      height={16}
      {...props}
      name="sessionLoading"
      data-component={props["data-component"] ?? "loading-indicator"}
      data-animation="loading-spin"
      aria-hidden={props["aria-hidden"] ?? "true"}
    />
  )
}
