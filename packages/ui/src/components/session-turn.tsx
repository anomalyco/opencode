import {
  AssistantMessage,
  FilePart,
  Message as MessageType,
  Part as PartType,
  type PermissionRequest,
  type QuestionRequest,
  TextPart,
  ToolPart,
} from "@opencode-ai/sdk/v2/client"
import { useData } from "../context"
import { type UiI18nKey, type UiI18nParams, useI18n } from "../context/i18n"

import { Binary } from "@opencode-ai/util/binary"
import { createEffect, createMemo, createSignal, For, Match, on, onCleanup, ParentProps, Show, Switch } from "solid-js"
import { Message, Part } from "./message-part"
import { Markdown } from "./markdown"
import { IconButton } from "./icon-button"
import { Card } from "./card"
import { Button } from "./button"
import { Spinner } from "./spinner"
import { Tooltip } from "./tooltip"
import { createStore } from "solid-js/store"
import { DateTime, DurationUnit, Interval } from "luxon"
import { createAutoScroll } from "../hooks"
import { createResizeObserver } from "@solid-primitives/resize-observer"

type Translator = (key: UiI18nKey, params?: UiI18nParams) => string

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function unwrap(message: string) {
  const text = message.replace(/^Error:\s*/, "").trim()

  const parse = (value: string) => {
    try {
      return JSON.parse(value) as unknown
    } catch {
      return undefined
    }
  }

  const read = (value: string) => {
    const first = parse(value)
    if (typeof first !== "string") return first
    return parse(first.trim())
  }

  let json = read(text)

  if (json === undefined) {
    const start = text.indexOf("{")
    const end = text.lastIndexOf("}")
    if (start !== -1 && end > start) {
      json = read(text.slice(start, end + 1))
    }
  }

  if (!record(json)) return message

  const err = record(json.error) ? json.error : undefined
  if (err) {
    const type = typeof err.type === "string" ? err.type : undefined
    const msg = typeof err.message === "string" ? err.message : undefined
    if (type && msg) return `${type}: ${msg}`
    if (msg) return msg
    if (type) return type
    const code = typeof err.code === "string" ? err.code : undefined
    if (code) return code
  }

  const msg = typeof json.message === "string" ? json.message : undefined
  if (msg) return msg

  const reason = typeof json.error === "string" ? json.error : undefined
  if (reason) return reason

  return message
}

function computeStatusFromPart(part: PartType | undefined, t: Translator): string | undefined {
  if (!part) return undefined

  if (part.type === "tool") {
    switch (part.tool) {
      case "task":
        return t("ui.sessionTurn.status.delegating")
      case "todowrite":
      case "todoread":
        return t("ui.sessionTurn.status.planning")
      case "read":
        return t("ui.sessionTurn.status.gatheringContext")
      case "list":
      case "grep":
      case "glob":
        return t("ui.sessionTurn.status.searchingCodebase")
      case "webfetch":
        return t("ui.sessionTurn.status.searchingWeb")
      case "edit":
      case "write":
        return t("ui.sessionTurn.status.makingEdits")
      case "bash":
        return t("ui.sessionTurn.status.runningCommands")
      default:
        return undefined
    }
  }
  if (part.type === "reasoning") {
    const text = part.text ?? ""
    const match = text.trimStart().match(/^\*\*(.+?)\*\*/)
    if (match) return t("ui.sessionTurn.status.thinkingWithTopic", { topic: match[1].trim() })
    return t("ui.sessionTurn.status.thinking")
  }
  if (part.type === "text") {
    return t("ui.sessionTurn.status.gatheringThoughts")
  }
  return undefined
}

function same<T>(a: readonly T[], b: readonly T[]) {
  if (a === b) return true
  if (a.length !== b.length) return false
  return a.every((x, i) => x === b[i])
}

function isAttachment(part: PartType | undefined) {
  if (part?.type !== "file") return false
  const mime = (part as FilePart).mime ?? ""
  return mime.startsWith("image/") || mime === "application/pdf"
}

function AssistantMessageItem(props: {
  message: AssistantMessage
  responsePartId: string | undefined
  hideResponsePart: boolean
  hideReasoning: boolean
  hidden?: () => readonly { messageID: string; callID: string }[]
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

    if (props.hideResponsePart) {
      const responsePartId = props.responsePartId
      if (responsePartId && responsePartId === lastTextPart()?.id) {
        parts = parts.filter((part) => part?.id !== responsePartId)
      }
    }

    const hidden = props.hidden?.() ?? []
    if (hidden.length === 0) return parts

    const id = props.message.id
    return parts.filter((part) => {
      if (part?.type !== "tool") return true
      const tool = part as ToolPart
      return !hidden.some((h) => h.messageID === id && h.callID === tool.callID)
    })
  })

  return <Message message={props.message} parts={filteredParts()} />
}

export function SessionTurn(
  props: ParentProps<{
    sessionID: string
    sessionTitle?: string
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
  const i18n = useI18n()
  const data = useData()

  const emptyMessages: MessageType[] = []
  const emptyParts: PartType[] = []
  const emptyFiles: FilePart[] = []
  const emptyAssistant: AssistantMessage[] = []
  const emptyPermissions: PermissionRequest[] = []
  const emptyQuestions: QuestionRequest[] = []
  const emptyQuestionParts: { part: ToolPart; message: AssistantMessage }[] = []
  const idle = { type: "idle" as const }

  const allMessages = createMemo(() => data.store.message[props.sessionID] ?? emptyMessages)

  const messageIndex = createMemo(() => {
    const messages = allMessages() ?? emptyMessages
    const result = Binary.search(messages, props.messageID, (m) => m.id)

    const index = result.found ? result.index : messages.findIndex((m) => m.id === props.messageID)
    if (index < 0) return -1

    const msg = messages[index]
    if (!msg || msg.role !== "user") return -1

    return index
  })

  const message = createMemo(() => {
    const index = messageIndex()
    if (index < 0) return undefined

    const messages = allMessages() ?? emptyMessages
    const msg = messages[index]
    if (!msg || msg.role !== "user") return undefined

    return msg
  })

  const lastUserMessageID = createMemo(() => {
    if (props.lastUserMessageID) return props.lastUserMessageID

    const messages = allMessages() ?? emptyMessages
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

  const attachmentParts = createMemo(() => {
    const msgParts = parts()
    if (msgParts.length === 0) return emptyFiles
    return msgParts.filter((part) => isAttachment(part)) as FilePart[]
  })

  const stickyParts = createMemo(() => {
    const msgParts = parts()
    if (msgParts.length === 0) return emptyParts
    if (attachmentParts().length === 0) return msgParts
    return msgParts.filter((part) => !isAttachment(part))
  })

  const assistantMessages = createMemo(
    () => {
      const msg = message()
      if (!msg) return emptyAssistant

      const messages = allMessages() ?? emptyMessages
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
  const errorText = createMemo(() => {
    const msg = error()?.data?.message
    if (typeof msg === "string") return unwrap(msg)
    if (msg === undefined || msg === null) return ""
    return unwrap(String(msg))
  })

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
  const nextPermission = createMemo(() => permissions()[0])

  const questions = createMemo(() => data.store.question?.[props.sessionID] ?? emptyQuestions)
  const nextQuestion = createMemo(() => questions()[0])

  const hidden = createMemo(() => {
    const out: { messageID: string; callID: string }[] = []
    const perm = nextPermission()
    if (perm?.tool) out.push(perm.tool)
    const question = nextQuestion()
    if (question?.tool) out.push(question.tool)
    return out
  })

  const answeredQuestionParts = createMemo(() => {
    if (props.stepsExpanded) return emptyQuestionParts
    if (questions().length > 0) return emptyQuestionParts

    const result: { part: ToolPart; message: AssistantMessage }[] = []

    for (const msg of assistantMessages()) {
      const parts = data.store.part[msg.id] ?? emptyParts
      for (const part of parts) {
        if (part?.type !== "tool") continue
        const tool = part as ToolPart
        if (tool.tool !== "question") continue
        // @ts-expect-error metadata may not exist on all tool states
        const answers = tool.state?.metadata?.answers
        if (answers && answers.length > 0) {
          result.push({ part: tool, message: msg })
        }
      }
    }

    return result
  })

  const shellModePart = createMemo(() => {
    const p = parts()
    if (p.length === 0) return
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
          if (part) return computeStatusFromPart(part, i18n.t)
        }
      }
    }

    return computeStatusFromPart(last, i18n.t)
  })

  const status = createMemo(() => data.store.session_status[props.sessionID] ?? idle)
  const working = createMemo(() => status().type !== "idle" && isLastUserMessage())
  const retry = createMemo(() => {
    // session_status is session-scoped; only show retry on the active (last) turn
    if (!isLastUserMessage()) return
    const s = status()
    if (s.type !== "retry") return
    return s
  })

  const response = createMemo(() => lastTextPart()?.text)
  const responsePartId = createMemo(() => lastTextPart()?.id)
  const hasDiffs = createMemo(() => (message()?.summary?.diffs?.length ?? 0) > 0)
  const hideResponsePart = createMemo(() => !working() && !!responsePartId())

  const [copied, setCopied] = createSignal(false)

  const handleCopy = async () => {
    const content = response() ?? ""
    if (!content) return
    await navigator.clipboard.writeText(content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const [rootRef, setRootRef] = createSignal<HTMLDivElement | undefined>()
  const [stickyRef, setStickyRef] = createSignal<HTMLDivElement | undefined>()

  const updateStickyHeight = (height: number) => {
    const root = rootRef()
    if (!root) return
    const next = Math.ceil(height)
    root.style.setProperty("--session-turn-sticky-height", `${next}px`)
  }

  function duration() {
    const msg = message()
    if (!msg) return ""
    const completed = lastAssistantMessage()?.time.completed
    const from = DateTime.fromMillis(msg.time.created)
    const to = completed ? DateTime.fromMillis(completed) : DateTime.now()
    const interval = Interval.fromDateTimes(from, to)
    const unit: DurationUnit[] = interval.length("seconds") > 60 ? ["minutes", "seconds"] : ["seconds"]

    const locale = i18n.locale()
    const human = interval.toDuration(unit).normalize().reconfigure({ locale }).toHuman({
      notation: "compact",
      unitDisplay: "narrow",
      compactDisplay: "short",
      showZeros: false,
    })
    return locale.startsWith("zh") ? human.replaceAll("、", "") : human
  }

  const autoScroll = createAutoScroll({
    working,
    onUserInteracted: props.onUserInteracted,
    overflowAnchor: "auto",
  })

  createResizeObserver(
    () => stickyRef(),
    ({ height }) => {
      updateStickyHeight(height)
    },
  )

  createEffect(() => {
    const root = rootRef()
    if (!root) return
    const sticky = stickyRef()
    if (!sticky) {
      root.style.setProperty("--session-turn-sticky-height", "0px")
      return
    }
    updateStickyHeight(sticky.getBoundingClientRect().height)
  })

  const [store, setStore] = createStore({
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

  let retryLog = ""
  createEffect(() => {
    const r = retry()
    if (!r) return
    const key = `${r.attempt}:${r.next}:${r.message}`
    if (key === retryLog) return
    retryLog = key
    console.warn("[session-turn] retry", {
      sessionID: props.sessionID,
      messageID: props.messageID,
      attempt: r.attempt,
      next: r.next,
      raw: r.message,
      parsed: unwrap(r.message),
    })
  })

  let errorLog = ""
  createEffect(() => {
    const value = error()?.data?.message
    if (value === undefined || value === null) return
    const raw = typeof value === "string" ? value : String(value)
    if (!raw) return
    if (raw === errorLog) return
    errorLog = raw
    console.warn("[session-turn] assistant-error", {
      sessionID: props.sessionID,
      messageID: props.messageID,
      raw,
      parsed: unwrap(raw),
    })
  })

  createEffect(() => {
    const update = () => {
      setStore("duration", duration())
    }

    update()

    // Only keep ticking while the active (in-progress) turn is running.
    if (!working()) return

    const timer = setInterval(update, 1000)
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

  onCleanup(() => {
    if (!statusTimeout) return
    clearTimeout(statusTimeout)
  })

  return (
    <div data-component="session-turn" class={props.classes?.root} ref={setRootRef}>
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
              >
                <Switch>
                  <Match when={isShellMode()}>
                    <Part part={shellModePart()!} message={msg()} defaultOpen />
                  </Match>
                  <Match when={true}>
                    <Show when={attachmentParts().length > 0}>
                      <div data-slot="session-turn-attachments" aria-live="off">
                        <Message message={msg()} parts={attachmentParts()} />
                      </div>
                    </Show>
                    <div data-slot="session-turn-sticky" ref={setStickyRef}>
                      {/* User Message */}
                      <div data-slot="session-turn-message-content" aria-live="off">
                        <Message message={msg()} parts={stickyParts()} />
                      </div>

                      {/* Trigger (sticky) */}
                      <Show when={working() || hasSteps()}>
                        <div data-slot="session-turn-response-trigger">
                          <Button
                            data-expandable={assistantMessages().length > 0}
                            data-slot="session-turn-collapsible-trigger-content"
                            variant="ghost"
                            size="small"
                            onClick={props.onStepsExpandedToggle ?? (() => {})}
                            aria-expanded={props.stepsExpanded}
                          >
                            <Switch>
                              <Match when={working()}>
                                <Spinner />
                              </Match>
                              <Match when={!props.stepsExpanded}>
                                <svg
                                  width="10"
                                  height="10"
                                  viewBox="0 0 10 10"
                                  fill="none"
                                  xmlns="http://www.w3.org/2000/svg"
                                  data-slot="session-turn-trigger-icon"
                                >
                                  <path
                                    d="M8.125 1.875H1.875L5 8.125L8.125 1.875Z"
                                    fill="currentColor"
                                    stroke="currentColor"
                                    stroke-linejoin="round"
                                  />
                                </svg>
                              </Match>
                              <Match when={props.stepsExpanded}>
                                <svg
                                  width="10"
                                  height="10"
                                  viewBox="0 0 10 10"
                                  fill="none"
                                  xmlns="http://www.w3.org/2000/svg"
                                  class="text-icon-base"
                                >
                                  <path
                                    d="M8.125 8.125H1.875L5 1.875L8.125 8.125Z"
                                    fill="currentColor"
                                    stroke="currentColor"
                                    stroke-linejoin="round"
                                  />
                                </svg>
                              </Match>
                            </Switch>
                            <Switch>
                              <Match when={retry()}>
                                <span data-slot="session-turn-retry-message">
                                  {(() => {
                                    const r = retry()
                                    if (!r) return ""
                                    const msg = unwrap(r.message)
                                    return msg.length > 60 ? msg.slice(0, 60) + "..." : msg
                                  })()}
                                </span>
                                <span data-slot="session-turn-retry-seconds">
                                  · {i18n.t("ui.sessionTurn.retry.retrying")}
                                  {store.retrySeconds > 0
                                    ? " " + i18n.t("ui.sessionTurn.retry.inSeconds", { seconds: store.retrySeconds })
                                    : ""}
                                </span>
                                <span data-slot="session-turn-retry-attempt">(#{retry()?.attempt})</span>
                              </Match>
                              <Match when={working()}>
                                <span data-slot="session-turn-status-text">
                                  {store.status ?? i18n.t("ui.sessionTurn.status.consideringNextSteps")}
                                </span>
                              </Match>
                              <Match when={props.stepsExpanded}>
                                <span data-slot="session-turn-status-text">{i18n.t("ui.sessionTurn.steps.hide")}</span>
                              </Match>
                              <Match when={!props.stepsExpanded}>
                                <span data-slot="session-turn-status-text">{i18n.t("ui.sessionTurn.steps.show")}</span>
                              </Match>
                            </Switch>
                            <span aria-hidden="true">·</span>
                            <span aria-live="off">{store.duration}</span>
                          </Button>
                        </div>
                      </Show>
                    </div>
                    {/* Response */}
                    <Show when={props.stepsExpanded && assistantMessages().length > 0}>
                      <div data-slot="session-turn-collapsible-content-inner" aria-hidden={working()}>
                        <For each={assistantMessages()}>
                          {(assistantMessage) => (
                            <AssistantMessageItem
                              message={assistantMessage}
                              responsePartId={responsePartId()}
                              hideResponsePart={hideResponsePart()}
                              hideReasoning={!working()}
                              hidden={hidden}
                            />
                          )}
                        </For>
                        <Show when={error()}>
                          <Card variant="error" class="error-card">
                            {errorText()}
                          </Card>
                        </Show>
                      </div>
                    </Show>
                    <Show when={!props.stepsExpanded && answeredQuestionParts().length > 0}>
                      <div data-slot="session-turn-answered-question-parts">
                        <For each={answeredQuestionParts()}>
                          {({ part, message }) => <Part part={part} message={message} />}
                        </For>
                      </div>
                    </Show>
                    {/* Response */}
                    <div class="sr-only" aria-live="polite">
                      {!working() && response() ? response() : ""}
                    </div>
                    <Show when={!working() && response()}>
                      <div data-slot="session-turn-summary-section">
                        <div data-slot="session-turn-summary-header">
                          <div data-slot="session-turn-summary-title-row">
                            <h2 data-slot="session-turn-summary-title">{i18n.t("ui.sessionTurn.summary.response")}</h2>
                            <Show when={response()}>
                              <div data-slot="session-turn-response-copy-wrapper">
                                <Tooltip
                                  value={copied() ? i18n.t("ui.message.copied") : i18n.t("ui.message.copy")}
                                  placement="top"
                                  gutter={8}
                                >
                                  <IconButton
                                    icon={copied() ? "check" : "copy"}
                                    size="small"
                                    variant="secondary"
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={(event) => {
                                      event.stopPropagation()
                                      handleCopy()
                                    }}
                                    aria-label={copied() ? i18n.t("ui.message.copied") : i18n.t("ui.message.copy")}
                                  />
                                </Tooltip>
                              </div>
                            </Show>
                          </div>
                          <div data-slot="session-turn-response">
                            <Markdown
                              data-slot="session-turn-markdown"
                              data-diffs={hasDiffs()}
                              text={response() ?? ""}
                              cacheKey={responsePartId()}
                            />
                          </div>
                        </div>
                      </div>
                    </Show>
                    <Show when={error() && !props.stepsExpanded}>
                      <Card variant="error" class="error-card">
                        {errorText()}
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
