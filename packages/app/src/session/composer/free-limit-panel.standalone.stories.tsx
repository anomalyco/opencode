import { Show } from "solid-js"
import { DialogStoryRuntime } from "@/components-lab/dialog-story-runtime"
import { SessionFreeLimitPanel } from "./free-limit-panel"
import { RecoverySession, RestoredComposer } from "./recovery-story"

type Args = { reset: "today" | "tomorrow" | "unknown"; paid: boolean }

function LimitStory(props: Args) {
  const resetAt = () => {
    if (props.reset === "unknown") return null
    const at = new Date()

    if (props.reset === "tomorrow") at.setDate(at.getDate() + 1)

    return at.setHours(23, 59, 59, 999)
  }

  return (
    <RecoverySession>
      <Show when={props.paid} fallback={<SessionFreeLimitPanel resetAt={resetAt()} selection={() => undefined} />}>
        <RestoredComposer />
      </Show>
    </RecoverySession>
  )
}

export default {
  title: "OpenCode/Session/Free limit",
  id: "session-free-limit",
  args: { reset: "today", paid: false } satisfies Args,
  argTypes: { reset: { options: ["today", "tomorrow", "unknown"] } },
  render: (args: Args) => (
    <DialogStoryRuntime>
      <LimitStory {...args} />
    </DialogStoryRuntime>
  ),
}

export const LimitReached = {}

export const NextDayReset = { args: { reset: "tomorrow" } }

export const UnknownReset = { args: { reset: "unknown" } }

export const PaidProviderConnected = { args: { paid: true } }
