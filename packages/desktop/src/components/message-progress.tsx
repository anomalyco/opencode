import { For, JSXElement, Match, Show, Switch, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { Markdown, Part } from "@opencode-ai/ui"
import { useSync } from "@/context/sync"
import type { AssistantMessage as AssistantMessageType, Part as PartType, ToolPart } from "@opencode-ai/sdk"
import { Spinner } from "./spinner"

export function MessageProgress(props: { assistantMessages: () => AssistantMessageType[]; done?: boolean }) {
  const sync = useSync()
  const parts = createMemo(() => props.assistantMessages().flatMap((m) => sync.data.part[m.id]))
  const done = createMemo(() => props.done ?? false)
  const currentTask = createMemo(
    () =>
      parts().findLast(
        (p) =>
          p &&
          p.type === "tool" &&
          p.tool === "task" &&
          p.state &&
          "metadata" in p.state &&
          p.state.metadata &&
          p.state.metadata.sessionId &&
          p.state.status === "running",
      ) as ToolPart,
  )

  const resolvedParts = createMemo(() => {
    let resolved = parts()
    const task = currentTask()
    if (task && task.state && "metadata" in task.state && task.state.metadata?.sessionId) {
      const messages = sync.data.message[task.state.metadata.sessionId as string]?.filter((m) => m.role === "assistant")
      resolved = messages?.flatMap((m) => sync.data.part[m.id]) ?? parts()
    }
    return resolved
  })
  const currentText = createMemo(
    () =>
      resolvedParts().findLast((p) => p?.type === "text")?.text ||
      resolvedParts().findLast((p) => p?.type === "reasoning")?.text,
  )
  const eligibleItems = createMemo(() => {
    return resolvedParts().filter((p) => p?.type === "tool" && p.state.status === "completed")
  })
  const finishedItems = createMemo<(JSXElement | PartType)[]>(() => [
    <div class="h-8 w-full" />,
    <div class="h-8 w-full" />,
    <div class="flex items-center gap-x-5 pl-3 text-text-base">
      <Spinner /> <span class="text-12-medium">Thinking...</span>
    </div>,
    ...eligibleItems(),
    ...(done() ? [<div class="h-8 w-full" />, <div class="h-8 w-full" />, <div class="h-8 w-full" />] : []),
  ])

  const delay = createMemo(() => (done() ? 220 : 400))
  const [visibleCount, setVisibleCount] = createSignal(eligibleItems().length)

  createEffect(() => {
    const total = finishedItems().length
    if (total > visibleCount()) {
      const timer = setTimeout(() => {
        setVisibleCount((prev) => prev + 1)
      }, delay())
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
    <div class="flex flex-col gap-3">
      <div
        class="h-30 overflow-hidden pointer-events-none pb-1 
               mask-alpha mask-t-from-33% mask-t-from-background-base mask-t-to-transparent
               mask-b-from-95% mask-b-from-background-base mask-b-to-transparent"
      >
        <div
          class="w-full flex flex-col items-start self-stretch gap-2 py-8
                 transform transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]"
          style={{ transform: `translateY(${translateY()})` }}
        >
          <For each={finishedItems()}>
            {(part) => {
              if (part && typeof part === "object" && "type" in part) {
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
                      <Match when={part.type === "tool" && part}>
                        {(p) => <Part message={message()!} part={p()} />}
                      </Match>
                    </Switch>
                  </div>
                )
              }
              return <div class="h-8 flex items-center w-full">{part}</div>
            }}
          </For>
        </div>
      </div>
      <Show when={currentText()}>
        {(text) => (
          <div
            class="max-h-36 flex flex-col justify-end overflow-hidden py-3
                   mask-alpha mask-t-from-80% mask-t-from-background-base mask-t-to-transparent"
          >
            <Markdown text={text()} class="w-full shrink-0 overflow-visible" />
          </div>
        )}
      </Show>
    </div>
  )
}
