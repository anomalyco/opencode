import { CurrentSessionProviders, pendingAndQueuedDocument } from "@opencode/session-ui/storybook"
import { SessionTimeline } from "@opencode/session-ui/timeline"
import { createSignal, type ParentProps } from "solid-js"
import { Composer } from "@/composer/composer"
import { createPromptController } from "@/session/story-model"

export function RecoverySession(props: ParentProps) {
  return (
    <div class="mx-auto flex h-[min(70dvh,550px)] w-full max-w-[760px] flex-col gap-4 p-4">
      <div data-scrollable class="min-h-0 flex-1 overflow-y-auto">
        <CurrentSessionProviders document={pendingAndQueuedDocument}>
          <SessionTimeline document={pendingAndQueuedDocument} />
        </CurrentSessionProviders>
      </div>
      {props.children}
    </div>
  )
}

export function RestoredComposer() {
  const [activity, setActivity] = createSignal("")

  const prompt = createPromptController({
    initial: "Continue with the timeline fixtures.",
    placeholder: "Ask anything",
    status: () => ({ type: "idle" }),
    onActivity: setActivity,
    onSubmit: (text) => setActivity(`Sent locally: ${text}`),
    onStop() {},
  })

  return (
    <div class="@container">
      <Composer model={prompt.controller} borderUnderlay />
      <output class="text-12-regular text-text-weak">{activity()}</output>
    </div>
  )
}
