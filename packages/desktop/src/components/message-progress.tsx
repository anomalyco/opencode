import { For, Match, Switch, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { Part } from "@opencode-ai/ui"
import { useSync } from "@/context/sync"
import type { AssistantMessage as AssistantMessageType } from "@opencode-ai/sdk"

export function MessageProgress(props: { assistantMessages: () => AssistantMessageType[] }) {
  const sync = useSync()
  const items = createMemo(() => props.assistantMessages().flatMap((m) => sync.data.part[m.id]))

  const finishedItems = createMemo(() => [
    "",
    "",
    "Loading...",
    ...items().filter(
      (p) =>
        p?.type === "text" ||
        (p?.type === "reasoning" && p.time?.end) ||
        (p?.type === "tool" && p.state.status === "completed"),
    ),
    "",
  ])

  const MINIMUM_DELAY = 400
  const [visibleCount, setVisibleCount] = createSignal(1)

  createEffect(() => {
    const total = finishedItems().length
    if (total > visibleCount()) {
      const timer = setTimeout(() => {
        setVisibleCount((prev) => prev + 1)
      }, MINIMUM_DELAY)
      onCleanup(() => clearTimeout(timer))
    } else if (total < visibleCount()) {
      setVisibleCount(total)
    }
  })

  const translateY = createMemo(() => {
    const total = visibleCount()
    if (total < 2) return "0px"
    return `-${(total - 2) * 40 - 8}px`
  })

  return (
    <div
      class="h-30 overflow-hidden pointer-events-none 
             mask-alpha mask-t-from-33% mask-t-from-background-base mask-t-to-transparent
             mask-b-from-90% mask-b-from-background-base mask-b-to-transparent"
    >
      <div
        class="w-full flex flex-col items-start self-stretch gap-2 py-8
               transform transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]"
        style={{ transform: `translateY(${translateY()})` }}
      >
        <For each={finishedItems()}>
          {(part) => {
            if (typeof part === "string") return <div class="h-8 flex items-center w-full">{part}</div>
            const message = createMemo(() => sync.data.message[part.sessionID].find((m) => m.id === part.messageID))
            return (
              <div class="h-8 flex items-center w-full">
                <Switch>
                  <Match when={part.type === "text" && part}>
                    {(p) => (
                      <div
                        textContent={p().text}
                        class="text-12-regular text-text-base whitespace-nowrap truncate w-full"
                      />
                    )}
                  </Match>
                  <Match when={part.type === "reasoning" && part}>
                    {(p) => <Part message={message()!} part={p()} />}
                  </Match>
                  <Match when={part.type === "tool" && part}>{(p) => <Part message={message()!} part={p()} />}</Match>
                </Switch>
              </div>
            )
          }}
        </For>
      </div>
    </div>
  )
}
