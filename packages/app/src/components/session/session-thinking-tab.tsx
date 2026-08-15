import { createMemo } from "solid-js"
import { useSessionLayout } from "@/pages/session/session-layout"
import { ThinkingStream, useSessionThinkingTarget } from "@/components/thinking-viewer"

export function SessionThinkingTab() {
  const { params } = useSessionLayout()
  const sessionID = createMemo(() => params.id)
  const { text, streaming } = useSessionThinkingTarget(sessionID)

  return (
    <div class="flex h-full min-h-0 flex-col">
      <ThinkingStream text={text} streaming={streaming} />
    </div>
  )
}
