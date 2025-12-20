import { AssistantMessage, Part as PartType, TextPart, ToolPart } from "@opencode-ai/sdk/v2/client"
import { useData } from "../context"
import { useDiffComponent } from "../context/diff"
import { getDirectory, getFilename } from "@opencode-ai/util/path"
import { checksum } from "@opencode-ai/util/encode"
import { batch, createEffect, createMemo, For, Match, onCleanup, ParentProps, Show, Switch } from "solid-js"
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

  const derived = createMemo(() => {
    const allMessages = data.store.message[props.sessionID] ?? []
    const userMessages = allMessages.filter((m) => m.role === "user").sort((a, b) => a.id.localeCompare(b.id))
    const lastUserMessage = userMessages.at(-1)
    const message = userMessages.find((m) => m.id === props.messageID)

    if (!message) {
      return {
        message: undefined,
        parts: [] as PartType[],
        assistantMessages: [] as AssistantMessage[],
        assistantParts: [] as PartType[],
        lastAssistantMessage: undefined as AssistantMessage | undefined,
        lastTextPart: undefined as PartType | undefined,
        error: undefined,
        hasSteps: false,
        isShellMode: false,
        rawStatus: undefined as string | undefined,
        isLastUserMessage: false,
      }
    }

    const parts = data.store.part[message.id] ?? []
    const assistantMessages = allMessages.filter(
      (m) => m.role === "assistant" && m.parentID === message.id,
    ) as AssistantMessage[]

    const assistantParts: PartType[] = []
    for (const m of assistantMessages) {
      const msgParts = data.store.part[m.id]
      if (msgParts) {
        for (const p of msgParts) {
          if (p) assistantParts.push(p)
        }
      }
    }

    const lastAssistantMessage = assistantMessages.at(-1)
    const error = assistantMessages.find((m) => m.error)?.error

    let lastTextPart: PartType | undefined
    for (let i = assistantParts.length - 1; i >= 0; i--) {
      if (assistantParts[i]?.type === "text") {
        lastTextPart = assistantParts[i]
        break
      }
    }

    const hasSteps = assistantParts.some((p) => p?.type === "tool")

    let isShellMode = false
    if (parts.every((p) => p?.type === "text" && p?.synthetic) && assistantParts.length === 1) {
      const assistantPart = assistantParts[0]
      if (assistantPart?.type === "tool" && assistantPart?.tool === "bash") {
        isShellMode = true
      }
    }

    let resolvedParts = assistantParts
    const currentTask = assistantParts.findLast(
      (p) =>
        p &&
        p.type === "tool" &&
        p.tool === "task" &&
        p.state &&
        "metadata" in p.state &&
        p.state.metadata &&
        p.state.metadata.sessionId &&
        p.state.status === "running",
    ) as ToolPart | undefined

    if (currentTask?.state && "metadata" in currentTask.state && currentTask.state.metadata?.sessionId) {
      const taskMessages = data.store.message[currentTask.state.metadata.sessionId as string]?.filter(
        (m) => m.role === "assistant",
      )
      if (taskMessages) {
        const taskParts: PartType[] = []
        for (const m of taskMessages) {
          const msgParts = data.store.part[m.id]
          if (msgParts) {
            for (const p of msgParts) {
              if (p) taskParts.push(p)
            }
          }
        }
        if (taskParts.length > 0) {
          resolvedParts = taskParts
        }
      }
    }

    const lastPart = resolvedParts.at(-1)
    const rawStatus = computeStatusFromPart(lastPart)

    return {
      message,
      parts,
      assistantMessages,
      assistantParts,
      lastAssistantMessage,
      lastTextPart,
      error,
      hasSteps,
      isShellMode,
      rawStatus,
      isLastUserMessage: message.id === lastUserMessage?.id,
    }
  })

  const message = () => derived().message
  const parts = () => derived().parts
  const assistantMessages = () => derived().assistantMessages
  const assistantParts = () => derived().assistantParts
  const lastAssistantMessage = () => derived().lastAssistantMessage
  const lastTextPart = () => derived().lastTextPart
  const error = () => derived().error
  const hasSteps = () => derived().hasSteps
  const isShellMode = () => derived().isShellMode
  const rawStatus = () => derived().rawStatus

  const status = createMemo(
    () =>
      data.store.session_status[props.sessionID] ?? {
        type: "idle",
      },
  )
  const working = createMemo(() => status().type !== "idle" && derived().isLastUserMessage)
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

  let scrollRef: HTMLDivElement | undefined
  const [store, setStore] = createStore({
    contentRef: undefined as HTMLDivElement | undefined,
    stickyTitleRef: undefined as HTMLDivElement | undefined,
    stickyTriggerRef: undefined as HTMLDivElement | undefined,
    lastScrollTop: 0,
    lastScrollHeight: 0,
    lastContainerWidth: 0,
    autoScrolled: false,
    userScrolled: false,
    reflowing: false,
    stickyHeaderHeight: 0,
    retrySeconds: 0,
    status: rawStatus(),
    duration: duration(),
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

  function handleScroll() {
    if (!scrollRef || store.autoScrolled) return

    const scrollTop = scrollRef.scrollTop
    const scrollHeight = scrollRef.scrollHeight

    if (store.reflowing) {
      batch(() => {
        setStore("lastScrollTop", scrollTop)
        setStore("lastScrollHeight", scrollHeight)
      })
      return
    }

    const scrollHeightChanged = Math.abs(scrollHeight - store.lastScrollHeight) > 10
    const scrollTopDelta = scrollTop - store.lastScrollTop

    if (scrollHeightChanged && scrollTopDelta < 0) {
      const heightRatio = store.lastScrollHeight > 0 ? scrollHeight / store.lastScrollHeight : 1
      const expectedScrollTop = store.lastScrollTop * heightRatio
      if (Math.abs(scrollTop - expectedScrollTop) < 100) {
        batch(() => {
          setStore("lastScrollTop", scrollTop)
          setStore("lastScrollHeight", scrollHeight)
        })
        return
      }
    }

    const reset = scrollTop <= 0 && store.lastScrollTop > 0 && working() && !store.userScrolled
    if (reset) {
      batch(() => {
        setStore("lastScrollTop", scrollTop)
        setStore("lastScrollHeight", scrollHeight)
      })
      requestAnimationFrame(scrollToBottom)
      return
    }

    const scrolledUp = scrollTop < store.lastScrollTop - 50 && !scrollHeightChanged
    if (scrolledUp && working()) {
      setStore("userScrolled", true)
      props.onUserInteracted?.()
    }

    batch(() => {
      setStore("lastScrollTop", scrollTop)
      setStore("lastScrollHeight", scrollHeight)
    })
  }

  function handleInteraction() {
    if (working()) {
      setStore("userScrolled", true)
      props.onUserInteracted?.()
    }
  }

  function scrollToBottom() {
    if (!scrollRef || store.userScrolled || !working()) return
    setStore("autoScrolled", true)
    requestAnimationFrame(() => {
      scrollRef?.scrollTo({ top: scrollRef.scrollHeight, behavior: "smooth" })
      requestAnimationFrame(() => {
        batch(() => {
          setStore("lastScrollTop", scrollRef?.scrollTop ?? 0)
          setStore("lastScrollHeight", scrollRef?.scrollHeight ?? 0)
          setStore("autoScrolled", false)
        })
      })
    })
  }

  createResizeObserver(
    () => store.contentRef,
    ({ width }) => {
      const widthChanged = Math.abs(width - store.lastContainerWidth) > 5
      if (widthChanged && store.lastContainerWidth > 0) {
        setStore("reflowing", true)
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            setStore("reflowing", false)
            if (working() && !store.userScrolled) {
              scrollToBottom()
            }
          })
        })
      } else if (!store.reflowing) {
        scrollToBottom()
      }
      setStore("lastContainerWidth", width)
    },
  )

  createEffect(() => {
    if (!working()) setStore("userScrolled", false)
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
      <div ref={scrollRef} onScroll={handleScroll} data-slot="session-turn-content" class={props.classes?.content}>
        <div onClick={handleInteraction}>
          <Show when={message()}>
            {(msg) => (
              <div
                ref={(el) => setStore("contentRef", el)}
                data-message={msg().id}
                data-slot="session-turn-message-container"
                class={props.classes?.container}
                style={{ "--sticky-header-height": `${store.stickyHeaderHeight}px` }}
              >
                <Switch>
                  <Match when={isShellMode()}>
                    <Part part={assistantParts()[0]} message={msg()} defaultOpen />
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
                          <Show when={working()}>
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
                          {(assistantMessage) => {
                            const parts = createMemo(() => data.store.part[assistantMessage.id] ?? [])
                            const last = createMemo(() =>
                              parts()
                                .filter((p) => p?.type === "text")
                                .at(-1),
                            )
                            return (
                              <Switch>
                                <Match when={response() && lastTextPart()?.id === last()?.id}>
                                  <Message
                                    message={assistantMessage}
                                    parts={parts().filter((p) => p?.id !== last()?.id)}
                                  />
                                </Match>
                                <Match when={true}>
                                  <Message message={assistantMessage} parts={parts()} />
                                </Match>
                              </Switch>
                            )
                          }}
                        </For>
                        <Show when={error()}>
                          <Card variant="error" class="error-card">
                            {error()?.data?.message as string}
                          </Card>
                        </Show>
                      </div>
                    </Show>
                    {/* Summary */}
                    <Show when={!working()}>
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
