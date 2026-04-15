import type { ParentProps } from "solid-js"
import { Toast } from "@opencode-ai/ui/toast"

export default function LayoutMinimal(props: ParentProps) {
  return (
    <div class="h-dvh w-screen overflow-hidden bg-background-base">
      {props.children}
      <Toast.Region />
    </div>
  )
}
