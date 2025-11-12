import { For, JSXElement, Match, Show, Switch, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { Part } from "@opencode-ai/ui"
import { useSync } from "@/context/sync"
import type { AssistantMessage as AssistantMessageType, ToolPart } from "@opencode-ai/sdk"
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
  // const currentText = createMemo(
  //   () =>
  //     resolvedParts().findLast((p) => p?.type === "text")?.text ||
  //     resolvedParts().findLast((p) => p?.type === "reasoning")?.text,
  // )
  const eligibleItems = createMemo(() => {
    return resolvedParts().filter((p) => p?.type === "tool" && p?.state.status === "completed") as ToolPart[]
  })
  const finishedItems = createMemo<(JSXElement | ToolPart)[]>(() => [
    <div class="h-8 w-full" />,
    <div class="h-8 w-full" />,
    <div class="h-8 w-full" />,
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

  const lastPart = createMemo(() => resolvedParts().slice(-1)?.at(0))
  const rawStatus = createMemo(() => {
    const last = lastPart()
    if (!last) return undefined

    if (last.type === "tool") {
      switch (last.tool) {
        case "task":
          return "Delegating work..."
        case "todowrite":
        case "todoread":
          return "Planning next steps..."
        case "read":
          return "Gathering context..."
        case "list":
        case "grep":
        case "glob":
          return "Searching the codebase..."
        case "webfetch":
          return "Searching the web..."
        case "edit":
        case "write":
          return "Making edits..."
        case "bash":
          return "Running commands..."
        default:
          break
      }
    } else if (last.type === "reasoning") {
      return "Thinking..."
    } else if (last.type === "text") {
      return "Gathering thoughts..."
    }
    return undefined
  })

  const [status, setStatus] = createSignal(rawStatus())
  let lastStatusChange = Date.now()
  let statusTimeout: number | undefined

  createEffect(() => {
    const newStatus = rawStatus()
    if (newStatus === status() || !newStatus) return

    const timeSinceLastChange = Date.now() - lastStatusChange

    if (timeSinceLastChange >= 1500) {
      setStatus(newStatus)
      lastStatusChange = Date.now()
      if (statusTimeout) {
        clearTimeout(statusTimeout)
        statusTimeout = undefined
      }
    } else {
      if (statusTimeout) clearTimeout(statusTimeout)
      statusTimeout = setTimeout(() => {
        setStatus(rawStatus())
        lastStatusChange = Date.now()
        statusTimeout = undefined
      }, 1000 - timeSinceLastChange) as unknown as number
    }
  })

  return (
    <div class="flex flex-col gap-3">
      {/* <Show when={currentText()}> */}
      {/*   {(text) => ( */}
      {/*     <div */}
      {/*       class="h-20 flex flex-col justify-end overflow-hidden py-3 */}
      {/*              mask-alpha mask-t-from-80% mask-t-from-background-base mask-t-to-transparent" */}
      {/*     > */}
      {/*       <Markdown text={text()} class="w-full shrink-0 overflow-visible" /> */}
      {/*     </div> */}
      {/*   )} */}
      {/* </Show> */}
      <div class="flex items-center gap-x-5 pl-3 border border-transparent text-text-base">
        <Spinner /> <span class="text-12-medium">{status() ?? "Considering next steps..."}</span>
      </div>
      <Show when={eligibleItems().length > 0}>
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
              {(part) => (
                <Switch>
                  <Match when={part && typeof part === "object" && "type" in part && part}>
                    {(p) => {
                      const part = p() as ToolPart
                      const message = createMemo(() =>
                        sync.data.message[part.sessionID].find((m) => m.id === part.messageID),
                      )
                      return (
                        <div class="h-8 flex items-center w-full">
                          <Part message={message()!} part={part} />
                        </div>
                      )
                    }}
                  </Match>
                  <Match when={true}>
                    <div class="h-8 flex items-center w-full">{part as JSXElement}</div>
                  </Match>
                </Switch>
              )}
            </For>
          </div>
        </div>
      </Show>
    </div>
  )
}
