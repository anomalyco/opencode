import { AssistantMessage, Part as PartType, TextPart, ToolPart } from "@opencode-ai/sdk/v2/client"
import { useData } from "../context"
import { useDiffComponent } from "../context/diff"
import { getDirectory, getFilename } from "@opencode-ai/util/path"
import { checksum } from "@opencode-ai/util/encode"
import { createEffect, createMemo, For, Match, onCleanup, ParentProps, Show, Switch } from "solid-js"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { DiffChanges } from "./diff-changes"
import { Typewriter } from "./typewriter"
import { Message, Part } from "./message-part"
import { Markdown } from "./markdown"
import { Accordion } from "./accordion"
import { StickyAccordionHeader } from "./sticky-accordion-header"
import { FileIcon } from "./file-icon"
import { Icon } from "./icon"
import { Card } from "./card"
import { Dynamic } from "solid-js/web"
import { Button } from "./button"
import { Spinner } from "./spinner"
import { createStore } from "solid-js/store"
import { DateTime, DurationUnit, Interval } from "luxon"
import { createAutoScroll } from "../hooks"

function computeStatusFromPart(part: PartType | undefined): string | undefined {
  if (!part) return undefined

  if (part.type === "tool") {
    switch (part.tool) {
      case "task":
        return "Delegating work"
      case "todowrite":
      case "todoread":
        return "Planning next steps"
      case "read":
        return "Gathering context"
      case "list":
      case "grep":
      case "glob":
        return "Searching the codebase"
      case "webfetch":
        return "Searching the web"
      case "edit":
      case "write":
        return "Making edits"
      case "bash":
        return "Running commands"
      default:
        return undefined
    }
  }
  if (part.type === "reasoning") {
    const text = part.text ?? ""
    const match = text.trimStart().match(/^\*\*(.+?)\*\*/)
    if (match) return `Thinking · ${match[1].trim()}`
    return "Thinking"
  }
  if (part.type === "text") {
    return "Gathering thoughts"
  }
  return undefined
}

function AssistantMessageItem(props: {
  message: AssistantMessage
  summary: string | undefined
  response: string | undefined
  lastTextPartId: string | undefined
  working: boolean
}) {
  const data = useData()
  const msgParts = createMemo(() => data.store.part[props.message.id] ?? [])
  const lastTextPart = createMemo(() =>
    msgParts()
      .filter((p) => p?.type === "text")
      .at(-1),
  )

  const filteredParts = createMemo(() => {
    if (!props.working && !props.summary && props.response && props.lastTextPartId === lastTextPart()?.id) {
      return msgParts().filter((p) => p?.id !== lastTextPart()?.id)
    }
    return msgParts()
  })

  return <Message message={props.message} parts={filteredParts()} />
}

export function SessionTurn(
  props: ParentProps<{
    sessionID: string
    messageID: string
    stepsExpanded?: boolean
    onStepsExpandedToggle?: () => void
    onUserInteracted?: () => void
    classes?: {
      root?: string
      content?: string
      container?: string
    }
  }>,
) {
  const data = useData()
  const diffComponent = useDiffComponent()

  const allMessages = createMemo(() => data.store.message[props.sessionID] ?? [])
  const userMessages = createMemo(() =>
    allMessages()
      .filter((m) => m.role === "user")
      .sort((a, b) => a.id.localeCompare(b.id)),
  )

  const message = createMemo(() => userMessages().find((m) => m.id === props.messageID))
  const isLastUserMessage = createMemo(() => message()?.id === userMessages().at(-1)?.id)

  const parts = createMemo(() => {
    const msg = message()
    if (!msg) return []
    return data.store.part[msg.id] ?? []
  })

  const assistantMessages = createMemo(() => {
    const msg = message()
    if (!msg) return [] as AssistantMessage[]
    return allMessages().filter((m) => m.role === "assistant" && m.parentID === msg.id) as AssistantMessage[]
  })

  const lastAssistantMessage = createMemo(() => assistantMessages().at(-1))

  const error = createMemo(() => assistantMessages().find((m) => m.error)?.error)

  const lastTextPart = createMemo(() => {
    const msgs = assistantMessages()
    for (let mi = msgs.length - 1; mi >= 0; mi--) {
      const msgParts = data.store.part[msgs[mi].id] ?? []
      for (let pi = msgParts.length - 1; pi >= 0; pi--) {
        const part = msgParts[pi]
        if (part?.type === "text") return part as TextPart
      }
    }
    return undefined
  })

  const hasSteps = createMemo(() => {
    for (const m of assistantMessages()) {
      const msgParts = data.store.part[m.id]
      if (!msgParts) continue
      for (const p of msgParts) {
        if (p?.type === "tool") return true
      }
    }
    return false
  })

  const shellModePart = createMemo(() => {
    const p = parts()
    if (!p.every((part) => part?.type === "text" && part?.synthetic)) return

    const msgs = assistantMessages()
    if (msgs.length !== 1) return

    const msgParts = data.store.part[msgs[0].id] ?? []
    if (msgParts.length !== 1) return

    const assistantPart = msgParts[0]
    if (assistantPart?.type === "tool" && assistantPart.tool === "bash") return assistantPart
  })

  const isShellMode = createMemo(() => !!shellModePart())

  const rawStatus = createMemo(() => {
    const msgs = assistantMessages()
    let last: PartType | undefined
    let currentTask: ToolPart | undefined

    for (let mi = msgs.length - 1; mi >= 0; mi--) {
      const msgParts = data.store.part[msgs[mi].id] ?? []
      for (let pi = msgParts.length - 1; pi >= 0; pi--) {
        const part = msgParts[pi]
        if (!part) continue
        if (!last) last = part

        if (
          part.type === "tool" &&
          part.tool === "task" &&
          part.state &&
          "metadata" in part.state &&
          part.state.metadata?.sessionId &&
          part.state.status === "running"
        ) {
          currentTask = part as ToolPart
          break
        }
      }
      if (currentTask) break
    }

    const taskSessionId =
      currentTask?.state && "metadata" in currentTask.state
        ? (currentTask.state.metadata?.sessionId as string | undefined)
        : undefined

    if (taskSessionId) {
      const taskMessages = data.store.message[taskSessionId] ?? []
      for (let mi = taskMessages.length - 1; mi >= 0; mi--) {
        const msg = taskMessages[mi]
        if (!msg || msg.role !== "assistant") continue

        const msgParts = data.store.part[msg.id] ?? []
        for (let pi = msgParts.length - 1; pi >= 0; pi--) {
          const part = msgParts[pi]
          if (part) return computeStatusFromPart(part)
        }
      }
    }

    return computeStatusFromPart(last)
  })

  const status = createMemo(
    () =>
      data.store.session_status[props.sessionID] ?? {
        type: "idle",
      },
  )
  const working = createMemo(() => status().type !== "idle" && isLastUserMessage())
  const retry = createMemo(() => {
    const s = status()
    if (s.type !== "retry") return
    return s
  })

  const summary = () => message()?.summary?.body
  const response = () => {
    const part = lastTextPart()
    return part?.type === "text" ? (part as TextPart).text : undefined
  }
  const hasDiffs = () => message()?.summary?.diffs?.length

  function duration() {
    const msg = message()
    if (!msg) return ""
    const completed = lastAssistantMessage()?.time.completed
    const from = DateTime.fromMillis(msg.time.created)
    const to = completed ? DateTime.fromMillis(completed) : DateTime.now()
    const interval = Interval.fromDateTimes(from, to)
    const unit: DurationUnit[] = interval.length("seconds") > 60 ? ["minutes", "seconds"] : ["seconds"]

    return interval.toDuration(unit).normalize().toHuman({
      notation: "compact",
      unitDisplay: "narrow",
      compactDisplay: "short",
      showZeros: false,
    })
  }

  const autoScroll = createAutoScroll({
    working,
    onUserInteracted: props.onUserInteracted,
  })

  const [store, setStore] = createStore({
    stickyTitleRef: undefined as HTMLDivElement | undefined,
    stickyTriggerRef: undefined as HTMLDivElement | undefined,
    stickyHeaderHeight: 0,
    retrySeconds: 0,
    status: rawStatus(),
    duration: duration(),
    summaryWaitTimedOut: false,
  })

  createEffect(() => {
    const r = retry()
    if (!r) {
      setStore("retrySeconds", 0)
      return
    }
    const updateSeconds = () => {
      const next = r.next
      if (next) setStore("retrySeconds", Math.max(0, Math.round((next - Date.now()) / 1000)))
    }
    updateSeconds()
    const timer = setInterval(updateSeconds, 1000)
    onCleanup(() => clearInterval(timer))
  })

  createResizeObserver(
    () => store.stickyTitleRef,
    ({ height }) => {
      const triggerHeight = store.stickyTriggerRef?.offsetHeight ?? 0
      setStore("stickyHeaderHeight", height + triggerHeight + 8)
    },
  )

  createResizeObserver(
    () => store.stickyTriggerRef,
    ({ height }) => {
      const titleHeight = store.stickyTitleRef?.offsetHeight ?? 0
      setStore("stickyHeaderHeight", titleHeight + height + 8)
    },
  )

  createEffect(() => {
    const timer = setInterval(() => {
      setStore("duration", duration())
    }, 1000)
    onCleanup(() => clearInterval(timer))
  })

  createEffect(() => {
    if (working()) {
      setStore("summaryWaitTimedOut", false)
    }
  })

  createEffect(() => {
    if (working() || !isLastUserMessage()) return

    const diffs = message()?.summary?.diffs
    if (!diffs?.length) return
    if (summary()) return
    if (store.summaryWaitTimedOut) return

    const timer = setTimeout(() => {
      setStore("summaryWaitTimedOut", true)
    }, 6000)
    onCleanup(() => clearTimeout(timer))
  })

  const waitingForSummary = createMemo(() => {
    if (!isLastUserMessage()) return false
    if (working()) return false

    const diffs = message()?.summary?.diffs
    if (!diffs?.length) return false
    if (summary()) return false

    return !store.summaryWaitTimedOut
  })

  const showSummarySection = createMemo(() => {
    if (working()) return false
    return !waitingForSummary()
  })

  let lastStatusChange = Date.now()
  let statusTimeout: number | undefined
  createEffect(() => {
    const newStatus = rawStatus()
    if (newStatus === store.status || !newStatus) return

    const timeSinceLastChange = Date.now() - lastStatusChange
    if (timeSinceLastChange >= 2500) {
      setStore("status", newStatus)
      lastStatusChange = Date.now()
      if (statusTimeout) {
        clearTimeout(statusTimeout)
        statusTimeout = undefined
      }
    } else {
      if (statusTimeout) clearTimeout(statusTimeout)
      statusTimeout = setTimeout(() => {
        setStore("status", rawStatus())
        lastStatusChange = Date.now()
        statusTimeout = undefined
      }, 2500 - timeSinceLastChange) as unknown as number
    }
  })

  return (
    <div data-component="session-turn" class={props.classes?.root}>
      <div
        ref={autoScroll.scrollRef}
        onScroll={autoScroll.handleScroll}
        data-slot="session-turn-content"
        class={props.classes?.content}
      >
        <div onClick={autoScroll.handleInteraction}>
          <Show when={message()}>
            {(msg) => (
              <div
                ref={autoScroll.contentRef}
                data-message={msg().id}
                data-slot="session-turn-message-container"
                class={props.classes?.container}
                style={{ "--sticky-header-height": `${store.stickyHeaderHeight}px` }}
              >
                <Switch>
                  <Match when={isShellMode()}>
                    <Part part={shellModePart()!} message={msg()} defaultOpen />
                  </Match>
                  <Match when={true}>
                    {/* Title (sticky) */}
                    <div ref={(el) => setStore("stickyTitleRef", el)} data-slot="session-turn-sticky-title">
                      <div data-slot="session-turn-message-header">
                        <div data-slot="session-turn-message-title">
                          <Switch>
                            <Match when={working()}>
                              <Typewriter as="h1" text={msg().summary?.title} data-slot="session-turn-typewriter" />
                            </Match>
                            <Match when={true}>
                              <h1>{msg().summary?.title}</h1>
                            </Match>
                          </Switch>
                        </div>
                      </div>
                    </div>
                    {/* User Message */}
                    <div data-slot="session-turn-message-content">
                      <Message message={msg()} parts={parts()} />
                    </div>
                    {/* Trigger (sticky) */}
                    <Show when={working() || hasSteps()}>
                      <div ref={(el) => setStore("stickyTriggerRef", el)} data-slot="session-turn-response-trigger">
                        <Button
                          data-expandable={assistantMessages().length > 0}
                          data-slot="session-turn-collapsible-trigger-content"
                          variant="ghost"
                          size="small"
                          onClick={props.onStepsExpandedToggle ?? (() => {})}
                        >
                          <Show when={working() || waitingForSummary()}>
                            <Spinner />
                          </Show>
                          <Switch>
                            <Match when={retry()}>
                              <span data-slot="session-turn-retry-message">
                                {(() => {
                                  const r = retry()
                                  if (!r) return ""
                                  return r.message.length > 60 ? r.message.slice(0, 60) + "..." : r.message
                                })()}
                              </span>
                              <span data-slot="session-turn-retry-seconds">
                                · retrying {store.retrySeconds > 0 ? `in ${store.retrySeconds}s ` : ""}
                              </span>
                              <span data-slot="session-turn-retry-attempt">(#{retry()?.attempt})</span>
                            </Match>
                            <Match when={waitingForSummary()}>Generating summary</Match>
                            <Match when={working()}>{store.status ?? "Considering next steps"}</Match>
                            <Match when={props.stepsExpanded}>Hide steps</Match>
                            <Match when={!props.stepsExpanded}>Show steps</Match>
                          </Switch>
                          <span>·</span>
                          <span>{store.duration}</span>
                          <Show when={assistantMessages().length > 0}>
                            <Icon name="chevron-grabber-vertical" size="small" />
                          </Show>
                        </Button>
                      </div>
                    </Show>
                    {/* Response */}
                    <Show when={props.stepsExpanded && assistantMessages().length > 0}>
                      <div data-slot="session-turn-collapsible-content-inner">
                        <For each={assistantMessages()}>
                          {(assistantMessage) => (
                            <AssistantMessageItem
                              message={assistantMessage}
                              summary={summary()}
                              response={response()}
                              lastTextPartId={lastTextPart()?.id}
                              working={working()}
                            />
                          )}
                        </For>
                        <Show when={error()}>
                          <Card variant="error" class="error-card">
                            {error()?.data?.message as string}
                          </Card>
                        </Show>
                      </div>
                    </Show>
                    {/* Summary */}
                    <Show when={showSummarySection()}>
                      <div data-slot="session-turn-summary-section">
                        <div data-slot="session-turn-summary-header">
                          <Switch>
                            <Match when={summary()}>
                              {(summary) => (
                                <>
                                  <h2 data-slot="session-turn-summary-title">Summary</h2>
                                  <Markdown
                                    data-slot="session-turn-markdown"
                                    data-diffs={hasDiffs()}
                                    text={summary()}
                                  />
                                </>
                              )}
                            </Match>
                            <Match when={response()}>
                              {(response) => (
                                <>
                                  <h2 data-slot="session-turn-summary-title">Response</h2>
                                  <Markdown
                                    data-slot="session-turn-markdown"
                                    data-diffs={hasDiffs()}
                                    text={response()}
                                  />
                                </>
                              )}
                            </Match>
                          </Switch>
                        </div>
                        <Accordion data-slot="session-turn-accordion" multiple>
                          <For each={msg().summary?.diffs ?? []}>
                            {(diff) => (
                              <Accordion.Item value={diff.file}>
                                <StickyAccordionHeader>
                                  <Accordion.Trigger>
                                    <div data-slot="session-turn-accordion-trigger-content">
                                      <div data-slot="session-turn-file-info">
                                        <FileIcon
                                          node={{ path: diff.file, type: "file" }}
                                          data-slot="session-turn-file-icon"
                                        />
                                        <div data-slot="session-turn-file-path">
                                          <Show when={diff.file.includes("/")}>
                                            <span data-slot="session-turn-directory">
                                              {getDirectory(diff.file)}&lrm;
                                            </span>
                                          </Show>
                                          <span data-slot="session-turn-filename">{getFilename(diff.file)}</span>
                                        </div>
                                      </div>
                                      <div data-slot="session-turn-accordion-actions">
                                        <DiffChanges changes={diff} />
                                        <Icon name="chevron-grabber-vertical" size="small" />
                                      </div>
                                    </div>
                                  </Accordion.Trigger>
                                </StickyAccordionHeader>
                                <Accordion.Content data-slot="session-turn-accordion-content">
                                  <Dynamic
                                    component={diffComponent}
                                    before={{
                                      name: diff.file!,
                                      contents: diff.before!,
                                      cacheKey: checksum(diff.before!),
                                    }}
                                    after={{
                                      name: diff.file!,
                                      contents: diff.after!,
                                      cacheKey: checksum(diff.after!),
                                    }}
                                  />
                                </Accordion.Content>
                              </Accordion.Item>
                            )}
                          </For>
                        </Accordion>
                      </div>
                    </Show>
                    <Show when={error() && !props.stepsExpanded}>
                      <Card variant="error" class="error-card">
                        {error()?.data?.message as string}
                      </Card>
                    </Show>
                  </Match>
                </Switch>
              </div>
            )}
          </Show>
          {props.children}
        </div>
      </div>
    </div>
  )
}
