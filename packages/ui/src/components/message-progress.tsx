import { For, JSXElement, Match, Show, Switch, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { Part } from "./message-part"
import { Spinner } from "./spinner"
import { useData } from "../context/data"
import type { AssistantMessage as AssistantMessageType, ToolPart } from "@opencode-ai/sdk"

export function MessageProgress(props: { assistantMessages: () => AssistantMessageType[]; done?: boolean }) {
  const data = useData()
  const sanitizer = createMemo(() => (data.directory ? new RegExp(`${data.directory}/`, "g") : undefined))
  const parts = createMemo(() => props.assistantMessages().flatMap((m) => data.store.part[m.id]))
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
      const messages = data.store.message[task.state.metadata.sessionId as string]?.filter(
        (m) => m.role === "assistant",
      )
      resolved = messages?.flatMap((m) => data.store.part[m.id]) ?? parts()
    }
    return resolved
  })

  const eligibleItems = createMemo(() => {
    return resolvedParts().filter((p) => p?.type === "tool" && p?.state.status === "completed") as ToolPart[]
  })
  const finishedItems = createMemo<(JSXElement | ToolPart)[]>(() => [
    <div data-slot="message-progress-item" />,
    <div data-slot="message-progress-item" />,
    <div data-slot="message-progress-item" />,
    ...eligibleItems(),
    ...(done()
      ? [
          <div data-slot="message-progress-item" />,
          <div data-slot="message-progress-item" />,
          <div data-slot="message-progress-item" />,
        ]
      : []),
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
    <div data-component="message-progress">
      <div data-slot="message-progress-status">
        <Spinner /> <span data-slot="message-progress-status-text">{status() ?? "Considering next steps..."}</span>
      </div>
      <Show when={eligibleItems().length > 0}>
        <div data-slot="message-progress-list-container">
          <div data-slot="message-progress-list" style={{ transform: `translateY(${translateY()})` }}>
            <For each={finishedItems()}>
              {(part) => (
                <Switch>
                  <Match when={part && typeof part === "object" && "type" in part && part}>
                    {(p) => {
                      const part = p() as ToolPart
                      const message = createMemo(() =>
                        data.store.message[part.sessionID].find((m) => m.id === part.messageID),
                      )
                      return (
                        <div data-slot="message-progress-item">
                          <Part message={message()!} part={part} sanitize={sanitizer()} />
                        </div>
                      )
                    }}
                  </Match>
                  <Match when={true}>
                    <div data-slot="message-progress-item">{part as JSXElement}</div>
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
