import { createEffect, createMemo, createSignal, onCleanup, type Accessor } from "solid-js"
import type { SessionMessageAssistantTool } from "@opencode/client/promise"

export function createToolElapsed(
  time: Accessor<SessionMessageAssistantTool["time"] | undefined>,
  running: Accessor<boolean>,
) {
  const [now, setNow] = createSignal(Date.now())
  createEffect(() => {
    if (time()?.ran === undefined || time()?.completed !== undefined || !running()) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    onCleanup(() => clearInterval(timer))
  })
  return createMemo(() => {
    const start = time()?.ran
    const end = time()?.completed ?? (running() ? now() : undefined)
    if (start === undefined || end === undefined) return undefined
    return Math.max(0, end - start)
  })
}
