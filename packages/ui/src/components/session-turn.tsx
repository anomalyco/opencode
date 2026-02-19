import { AssistantMessage, type FileDiff, Message as MessageType, Part as PartType } from "@opencode-ai/sdk/v2/client"
import { useData } from "../context"
import { useDiffComponent } from "../context/diff"

import { Binary } from "@opencode-ai/util/binary"
import { getDirectory, getFilename } from "@opencode-ai/util/path"
import { createEffect, createMemo, createSignal, For, on, ParentProps, Show } from "solid-js"
import { Dynamic } from "solid-js/web"
import { AssistantParts, Message } from "./message-part"
import { Card } from "./card"
import { Accordion } from "./accordion"
import { Collapsible } from "./collapsible"
import { DiffChanges } from "./diff-changes"
import { Icon } from "./icon"
import { TextShimmer } from "./text-shimmer"
import { createAutoScroll } from "../hooks"
import { useI18n } from "../context/i18n"

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

function same<T>(a: readonly T[], b: readonly T[]) {
  if (a === b) return true
  if (a.length !== b.length) return false
  return a.every((x, i) => x === b[i])
}

function list<T>(value: T[] | undefined | null, fallback: T[]) {
  if (Array.isArray(value)) return value
  return fallback
}

const hidden = new Set(["todowrite", "todoread"])

function visible(part: PartType) {
  if (part.type === "tool") {
    if (hidden.has(part.tool)) return false
    if (part.tool === "question") return part.state.status !== "pending" && part.state.status !== "running"
    return true
  }
  if (part.type === "text") return !!part.text?.trim()
  if (part.type === "reasoning") return !!part.text?.trim()
  return false
}

export function SessionTurn(
  props: ParentProps<{
    sessionID: string
    messageID: string
    lastUserMessageID?: string
    onUserInteracted?: () => void
    classes?: {
      root?: string
      content?: string
      container?: string
    }
  }>,
) {
  const data = useData()
  const i18n = useI18n()
  const diffComponent = useDiffComponent()

  const emptyMessages: MessageType[] = []
  const emptyParts: PartType[] = []
  const emptyAssistant: AssistantMessage[] = []
  const emptyDiffs: FileDiff[] = []
  const idle = { type: "idle" as const }

  const allMessages = createMemo(() => list(data.store.message?.[props.sessionID], emptyMessages))

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
    return list(data.store.part?.[msg.id], emptyParts)
  })

  const diffs = createMemo(() => {
    const files = message()?.summary?.diffs
    if (!files?.length) return emptyDiffs

    const seen = new Set<string>()
    return files
      .reduceRight<FileDiff[]>((result, diff) => {
        if (seen.has(diff.file)) return result
        seen.add(diff.file)
        result.push(diff)
        return result
      }, [])
      .reverse()
  })
  const edited = createMemo(() => diffs().length)
  const [open, setOpen] = createSignal(false)
  const [expanded, setExpanded] = createSignal<string[]>([])

  createEffect(
    on(
      open,
      (value, prev) => {
        if (!value && prev) setExpanded([])
      },
      { defer: true },
    ),
  )

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

  const interrupted = createMemo(() => assistantMessages().some((m) => m.error?.name === "MessageAbortedError"))
  const error = createMemo(
    () => assistantMessages().find((m) => m.error && m.error.name !== "MessageAbortedError")?.error,
  )
  const showAssistantCopyPartID = createMemo(() => {
    const messages = assistantMessages()

    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i]
      if (!message) continue

      const parts = list(data.store.part?.[message.id], emptyParts)
      for (let j = parts.length - 1; j >= 0; j--) {
        const part = parts[j]
        if (!part || part.type !== "text" || !part.text?.trim()) continue
        return part.id
      }
    }

    return undefined
  })
  const errorText = createMemo(() => {
    const msg = error()?.data?.message
    if (typeof msg === "string") return unwrap(msg)
    if (msg === undefined || msg === null) return ""
    return unwrap(String(msg))
  })

  const status = createMemo(() => data.store.session_status[props.sessionID] ?? idle)
  const working = createMemo(() => status().type !== "idle" && isLastUserMessage())

  const assistantCopyPartID = createMemo(() => {
    if (working()) return null
    return showAssistantCopyPartID() ?? null
  })
  const assistantVisible = createMemo(() =>
    assistantMessages().reduce((count, message) => {
      const parts = list(data.store.part?.[message.id], emptyParts)
      return count + parts.filter(visible).length
    }, 0),
  )

  const autoScroll = createAutoScroll({
    working,
    onUserInteracted: props.onUserInteracted,
    overflowAnchor: "dynamic",
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
              >
                <div data-slot="session-turn-message-content" aria-live="off">
                  <Message message={msg()} parts={parts()} interrupted={interrupted()} />
                </div>
                <Show when={working() && assistantVisible() === 0 && !error()}>
                  <div data-slot="session-turn-thinking">
                    <TextShimmer text={i18n.t("ui.sessionTurn.status.thinking")} />
                  </div>
                </Show>
                <Show when={assistantMessages().length > 0}>
                  <div data-slot="session-turn-assistant-content" aria-hidden={working()}>
                    <AssistantParts
                      messages={assistantMessages()}
                      showAssistantCopyPartID={assistantCopyPartID()}
                      working={working()}
                    />
                  </div>
                </Show>
                <Show when={edited() > 0 && !working()}>
                  <div data-slot="session-turn-diffs">
                    <Collapsible open={open()} onOpenChange={setOpen} variant="ghost">
                      <Collapsible.Trigger>
                        <div data-component="session-turn-diffs-trigger">
                          <div data-slot="session-turn-diffs-title">
                            <span data-slot="session-turn-diffs-label">
                              {i18n.t("ui.sessionReview.change.modified")}
                            </span>
                            <span data-slot="session-turn-diffs-count">
                              {edited()} {i18n.t(edited() === 1 ? "ui.common.file.one" : "ui.common.file.other")}
                            </span>
                            <div data-slot="session-turn-diffs-meta">
                              <DiffChanges changes={diffs()} variant="bars" />
                              <Collapsible.Arrow />
                            </div>
                          </div>
                        </div>
                      </Collapsible.Trigger>
                      <Collapsible.Content>
                        <Show when={open()}>
                          <div data-component="session-turn-diffs-content">
                            <Accordion
                              multiple
                              value={expanded()}
                              onChange={(value) => setExpanded(Array.isArray(value) ? value : value ? [value] : [])}
                            >
                              <For each={diffs()}>
                                {(diff) => {
                                  const active = createMemo(() => expanded().includes(diff.file))
                                  const [visible, setVisible] = createSignal(false)

                                  createEffect(
                                    on(
                                      active,
                                      (value) => {
                                        if (!value) {
                                          setVisible(false)
                                          return
                                        }

                                        requestAnimationFrame(() => {
                                          if (!active()) return
                                          setVisible(true)
                                        })
                                      },
                                      { defer: true },
                                    ),
                                  )

                                  return (
                                    <Accordion.Item value={diff.file}>
                                      <Accordion.Header>
                                        <Accordion.Trigger>
                                          <div data-slot="session-turn-diff-trigger">
                                            <span data-slot="session-turn-diff-path">
                                              <Show when={diff.file.includes("/")}>
                                                <span data-slot="session-turn-diff-directory">
                                                  {getDirectory(diff.file)}
                                                </span>
                                              </Show>
                                              <span data-slot="session-turn-diff-filename">
                                                {getFilename(diff.file)}
                                              </span>
                                            </span>
                                            <div data-slot="session-turn-diff-meta">
                                              <span data-slot="session-turn-diff-changes">
                                                <DiffChanges changes={diff} />
                                              </span>
                                              <span data-slot="session-turn-diff-chevron">
                                                <Icon name="chevron-down" size="small" />
                                              </span>
                                            </div>
                                          </div>
                                        </Accordion.Trigger>
                                      </Accordion.Header>
                                      <Accordion.Content>
                                        <Show when={visible()}>
                                          <div data-slot="session-turn-diff-view" data-scrollable>
                                            <Dynamic
                                              component={diffComponent}
                                              before={{ name: diff.file, contents: diff.before }}
                                              after={{ name: diff.file, contents: diff.after }}
                                            />
                                          </div>
                                        </Show>
                                      </Accordion.Content>
                                    </Accordion.Item>
                                  )
                                }}
                              </For>
                            </Accordion>
                          </div>
                        </Show>
                      </Collapsible.Content>
                    </Collapsible>
                  </div>
                </Show>
                <Show when={error()}>
                  <Card variant="error" class="error-card">
                    {errorText()}
                  </Card>
                </Show>
              </div>
            )}
          </Show>
          {props.children}
        </div>
      </div>
    </div>
  )
}
