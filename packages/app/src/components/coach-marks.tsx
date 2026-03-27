import { createEffect, createMemo, createSignal, For, on, Show } from "solid-js"
import { useSettings } from "@/context/settings"
import { useSync } from "@/context/sync"
import { useSDK } from "@/context/sdk"

type Mark = {
  id: string
  text: string
  sub: string
}

const MARKS: Mark[] = [
  {
    id: "fork",
    text: "Fork this session",
    sub: "Try a different approach without losing your current conversation",
  },
  {
    id: "mention",
    text: "Use @ to add context",
    sub: "Mention a file or agent with @ to bring it into the conversation",
  },
  {
    id: "model",
    text: "Switch models anytime",
    sub: "Change the model mid-conversation using the model selector below",
  },
]

export function CoachMarks(props: { sessionID: string | undefined }) {
  const settings = useSettings()
  const sync = useSync()
  const sdk = useSDK()

  const [active, setActive] = createSignal(0)

  const hasCompleted = createMemo(() => {
    const id = props.sessionID
    if (!id) return false
    const messages = sync.data.message[id] ?? []
    return messages.some(
      (m) => m.role === "assistant" && typeof (m as { time?: { completed?: unknown } }).time?.completed === "number",
    )
  })

  createEffect(
    on(hasCompleted, (done) => {
      if (!done) return
      if (settings.onboarding.completedFirstSession()) return
      settings.onboarding.setCompletedFirstSession(true)
    }),
  )

  const visible = createMemo(() => {
    if (!settings.onboarding.completedFirstSession()) return false
    return active() < MARKS.length
  })

  const current = createMemo(() => MARKS[active()])

  const dismissed = createMemo(() => {
    const mark = current()
    if (!mark) return true
    return settings.onboarding.isDismissed(mark.id)()
  })

  const dismiss = () => {
    const mark = current()
    if (mark) settings.onboarding.dismiss(mark.id)
    setActive((a) => a + 1)
  }

  const dismissAll = () => {
    MARKS.forEach((m) => settings.onboarding.dismiss(m.id))
    setActive(MARKS.length)
  }

  return (
    <Show when={visible() && !dismissed()}>
      <div
        data-component="coach-marks"
        class="fixed bottom-24 right-6 z-50 w-72 rounded-xl bg-surface-raised-stronger-non-alpha shadow-[var(--shadow-lg-border-base)] p-4 flex flex-col gap-3 animate-in fade-in slide-in-from-bottom-2 duration-300"
      >
        <div class="flex items-start justify-between gap-2">
          <div class="flex flex-col gap-0.5">
            <span class="text-13-medium text-text-strong">{current()?.text}</span>
            <span class="text-12-regular text-text-weak leading-[1.5]">{current()?.sub}</span>
          </div>
          <button
            class="shrink-0 size-5 flex items-center justify-center rounded text-text-weak hover:text-text-strong transition-colors"
            onClick={dismiss}
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
        <div class="flex items-center justify-between">
          <div class="flex gap-1">
            <For each={MARKS}>
              {(_, i) => (
                <div
                  class="size-1.5 rounded-full transition-colors"
                  classList={{
                    "bg-text-interactive-base": i() === active(),
                    "bg-border-base": i() !== active(),
                  }}
                />
              )}
            </For>
          </div>
          <button
            class="text-11-regular text-text-weakest hover:text-text-weak transition-colors"
            onClick={dismissAll}
          >
            Don't show again
          </button>
        </div>
      </div>
    </Show>
  )
}
