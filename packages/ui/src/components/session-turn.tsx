import {
  AssistantMessage,
  Message as MessageType,
  Part as PartType,
  type PermissionRequest,
  TextPart,
  ToolPart,
  UserMessage,
} from "@opencode-ai/sdk/v2/client"
import { useData } from "../context"
import { useDiffComponent } from "../context/diff"
import { getDirectory, getFilename } from "@opencode-ai/util/path"

import { Binary } from "@opencode-ai/util/binary"
import { createEffect, createMemo, createSignal, For, Match, on, onCleanup, ParentProps, Show, Switch } from "solid-js"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { DiffChanges } from "./diff-changes"
import { Typewriter } from "./typewriter"
import { Message, Part } from "./message-part"
import { Markdown } from "./markdown"
import { Accordion } from "./accordion"
import { StickyAccordionHeader } from "./sticky-accordion-header"
import { FileIcon } from "./file-icon"
import { Icon } from "./icon"
import { ProviderIcon } from "./provider-icon"
import type { IconName } from "./provider-icons/types"
import { IconButton } from "./icon-button"
import { Tooltip } from "./tooltip"
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

function same<T>(a: readonly T[], b: readonly T[]) {
  if (a === b) return true
  if (a.length !== b.length) return false
  return a.every((x, i) => x === b[i])
}

function AssistantMessageItem(props: {
  message: AssistantMessage
  responsePartId: string | undefined
  hideResponsePart: boolean
  hideReasoning: boolean
}) {
  const data = useData()
  const emptyParts: PartType[] = []
  const msgParts = createMemo(() => data.store.part[props.message.id] ?? emptyParts)
  const lastTextPart = createMemo(() => {
    const parts = msgParts()
    for (let i = parts.length - 1; i >= 0; i--) {
      const part = parts[i]
      if (part?.type === "text") return part as TextPart
    }
    return undefined
  })

  const filteredParts = createMemo(() => {
    let parts = msgParts()

    if (props.hideReasoning) {
      parts = parts.filter((part) => part?.type !== "reasoning")
    }

    if (!props.hideResponsePart) return parts

    const responsePartId = props.responsePartId
    if (!responsePartId) return parts
    if (responsePartId !== lastTextPart()?.id) return parts

    return parts.filter((part) => part?.id !== responsePartId)
  })

  return <Message message={props.message} parts={filteredParts()} />
}

export function SessionTurn(
  props: ParentProps<{
    sessionID: string
    messageID: string
    lastUserMessageID?: string
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

  const emptyMessages: MessageType[] = []
  const emptyParts: PartType[] = []
  const emptyAssistant: AssistantMessage[] = []
  const emptyPermissions: PermissionRequest[] = []
  const emptyPermissionParts: { part: ToolPart; message: AssistantMessage }[] = []
  const idle = { type: "idle" as const }

  const allMessages = createMemo(() => data.store.message[props.sessionID] ?? emptyMessages)

  const messageIndex = createMemo(() => {
    const messages = allMessages()
    const result = Binary.search(messages, props.messageID, (m) => m.id)
    if (!result.found) return -1

    const msg = messages[result.index]
    if (msg.role !== "user") return -1

    return result.index
  })

  const message = createMemo(() => {
    const index = messageIndex()
    if (index < 0) return undefined

    const msg = allMessages()[index]
    if (!msg || msg.role !== "user") return undefined

    return msg
  })

  const lastUserMessageID = createMemo(() => {
    if (props.lastUserMessageID) return props.lastUserMessageID

    const messages = allMessages()
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      if (msg?.role === "user") return msg.id
    }
    return undefined
  })

  const isLastUserMessage = createMemo(() => props.messageID === lastUserMessageID())

  const parts = createMemo(() => {
    const msg = message()
    if (!msg) return emptyParts
    return data.store.part[msg.id] ?? emptyParts
  })

  const assistantMessages = createMemo(
    () => {
      const msg = message()
      if (!msg) return emptyAssistant

      const messages = allMessages()
      const index = messageIndex()
      if (index < 0) return emptyAssistant

      const result: AssistantMessage[] = []
      for (let i = index + 1; i < messages.length; i++) {
        const item = messages[i]
        if (!item) continue
        if (item.role === "user") break
        if (item.role === "assistant" && item.parentID === msg.id) result.push(item as AssistantMessage)
      }
      return result
    },
    emptyAssistant,
    { equals: same },
  )

  const lastAssistantMessage = createMemo(() => assistantMessages().at(-1))

  const error = createMemo(() => assistantMessages().find((m) => m.error)?.error)

  const lastTextPart = createMemo(() => {
    const msgs = assistantMessages()
    for (let mi = msgs.length - 1; mi >= 0; mi--) {
      const msgParts = data.store.part[msgs[mi].id] ?? emptyParts
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

  const permissions = createMemo(() => data.store.permission?.[props.sessionID] ?? emptyPermissions)
  const permissionCount = createMemo(() => permissions().length)
  const nextPermission = createMemo(() => permissions()[0])

  const permissionParts = createMemo(() => {
    if (props.stepsExpanded) return emptyPermissionParts

    const next = nextPermission()
    if (!next || !next.tool) return emptyPermissionParts

    const message = assistantMessages().findLast((m) => m.id === next.tool!.messageID)
    if (!message) return emptyPermissionParts

    const parts = data.store.part[message.id] ?? emptyParts
    for (const part of parts) {
      if (part?.type !== "tool") continue
      const tool = part as ToolPart
      if (tool.callID === next.tool?.callID) return [{ part: tool, message }]
    }

    return emptyPermissionParts
  })

  const shellModePart = createMemo(() => {
    const p = parts()
    if (!p.every((part) => part?.type === "text" && part?.synthetic)) return

    const msgs = assistantMessages()
    if (msgs.length !== 1) return

    const msgParts = data.store.part[msgs[0].id] ?? emptyParts
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
      const msgParts = data.store.part[msgs[mi].id] ?? emptyParts
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
      const taskMessages = data.store.message[taskSessionId] ?? emptyMessages
      for (let mi = taskMessages.length - 1; mi >= 0; mi--) {
        const msg = taskMessages[mi]
        if (!msg || msg.role !== "assistant") continue

        const msgParts = data.store.part[msg.id] ?? emptyParts
        for (let pi = msgParts.length - 1; pi >= 0; pi--) {
          const part = msgParts[pi]
          if (part) return computeStatusFromPart(part)
        }
      }
    }

    return computeStatusFromPart(last)
  })

  const status = createMemo(() => data.store.session_status[props.sessionID] ?? idle)
  const working = createMemo(() => status().type !== "idle" && isLastUserMessage())
  const retry = createMemo(() => {
    const s = status()
    if (s.type !== "retry") return
    return s
  })

  const response = createMemo(() => lastTextPart()?.text)
  const responsePartId = createMemo(() => lastTextPart()?.id)
  const hasDiffs = createMemo(() => message()?.summary?.diffs?.length)
  const hideResponsePart = createMemo(() => !working() && !!responsePartId())

  const [responseCopied, setResponseCopied] = createSignal(false)
  const handleCopyResponse = async () => {
    const content = response()
    if (!content) return
    await navigator.clipboard.writeText(content)
    setResponseCopied(true)
    setTimeout(() => setResponseCopied(false), 2000)
  }

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

  const diffInit = 20
  const diffBatch = 20

  const [store, setStore] = createStore({
    stickyTitleRef: undefined as HTMLDivElement | undefined,
    stickyTriggerRef: undefined as HTMLDivElement | undefined,
    stickyHeaderHeight: 0,
    retrySeconds: 0,
    diffsOpen: [] as string[],
    diffLimit: diffInit,
    status: rawStatus(),
    duration: duration(),
  })

  createEffect(
    on(
      () => message()?.id,
      () => {
        setStore("diffsOpen", [])
        setStore("diffLimit", diffInit)
      },
      { defer: true },
    ),
  )

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

  createEffect(
    on(permissionCount, (count, prev) => {
      if (!count) return
      if (prev !== undefined && count <= prev) return
      autoScroll.forceScrollToBottom()
    }),
  )

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
                        <div data-slot="session-turn-user-badges">
                          <Show when={(msg() as UserMessage).agent}>
                            <span data-slot="session-turn-badge">{(msg() as UserMessage).agent}</span>
                          </Show>
                          <Show when={(msg() as UserMessage).model?.modelID}>
                            <span data-slot="session-turn-badge" class="inline-flex items-center gap-1">
                              <ProviderIcon
                                id={(msg() as UserMessage).model!.providerID as IconName}
                                class="size-3.5 shrink-0"
                              />
                              {(msg() as UserMessage).model?.modelID}
                            </span>
                          </Show>
                          <span data-slot="session-turn-badge">{(msg() as UserMessage).variant || "default"}</span>
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
                          {(assistantMessage) => (
                            <AssistantMessageItem
                              message={assistantMessage}
                              responsePartId={responsePartId()}
                              hideResponsePart={hideResponsePart()}
                              hideReasoning={!working()}
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
                    <Show when={!props.stepsExpanded && permissionParts().length > 0}>
                      <div data-slot="session-turn-permission-parts">
                        <For each={permissionParts()}>
                          {({ part, message }) => <Part part={part} message={message} />}
                        </For>
                      </div>
                    </Show>
                    {/* Response */}
                    <Show when={!working() && (response() || hasDiffs())}>
                      <div data-slot="session-turn-summary-section">
                        <div data-slot="session-turn-summary-copy">
                          <Tooltip value={responseCopied() ? "Copied!" : "Copy"} placement="top" gutter={8}>
                            <IconButton
                              icon={responseCopied() ? "check" : "copy"}
                              variant="secondary"
                              onClick={handleCopyResponse}
                            />
                          </Tooltip>
                        </div>
                        <div data-slot="session-turn-summary-header">
                          <h2 data-slot="session-turn-summary-title">Response</h2>
                          <Markdown
                            data-slot="session-turn-markdown"
                            data-diffs={hasDiffs()}
                            text={response() ?? ""}
                            cacheKey={responsePartId()}
                          />
                        </div>
                        <Accordion
                          data-slot="session-turn-accordion"
                          multiple
                          value={store.diffsOpen}
                          onChange={(value) => {
                            if (!Array.isArray(value)) return
                            setStore("diffsOpen", value)
                          }}
                        >
                          <For each={(msg().summary?.diffs ?? []).slice(0, store.diffLimit)}>
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
                                  <Show when={store.diffsOpen.includes(diff.file!)}>
                                    <Dynamic
                                      component={diffComponent}
                                      before={{
                                        name: diff.file!,
                                        contents: diff.before!,
                                      }}
                                      after={{
                                        name: diff.file!,
                                        contents: diff.after!,
                                      }}
                                    />
                                  </Show>
                                </Accordion.Content>
                              </Accordion.Item>
                            )}
                          </For>
                        </Accordion>
                        <Show when={(msg().summary?.diffs?.length ?? 0) > store.diffLimit}>
                          <Button
                            data-slot="session-turn-accordion-more"
                            variant="ghost"
                            size="small"
                            onClick={() => {
                              const total = msg().summary?.diffs?.length ?? 0
                              setStore("diffLimit", (limit) => {
                                const next = limit + diffBatch
                                if (next > total) return total
                                return next
                              })
                            }}
                          >
                            Show more changes ({(msg().summary?.diffs?.length ?? 0) - store.diffLimit})
                          </Button>
                        </Show>
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
