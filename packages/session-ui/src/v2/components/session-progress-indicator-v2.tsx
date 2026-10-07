import { type ComponentProps } from "solid-js"
import { LoadingIndicator } from "@opencode-ai/ui/loading-indicator"

export function SessionProgressIndicatorV2(props: ComponentProps<"svg">) {
  return <LoadingIndicator {...props} data-component="session-progress-indicator-v2" />
}
