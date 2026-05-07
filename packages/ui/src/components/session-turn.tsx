import {
  AssistantMessage,
  type SnapshotFileDiff,
  Message as MessageType,
  Part as PartType,
} from "@opencode-ai/sdk/v2/client"
import type { SessionStatus } from "@opencode-ai/sdk/v2"
import { useData } from "../context"
import { useFileComponent } from "../context/file"

import { Binary } from "@opencode-ai/util/binary"
import { getDirectory, getFilename } from "@opencode-ai/util/path"
import { createEffect, createMemo, createSignal, For, on, onCleanup, ParentProps, Show } from "solid-js"
import { Dynamic } from "solid-js/web"
import { AssistantParts, Message, MessageDivider, Part, PART_MAPPING, type UserActions } from "./message-part"
import type { MarkdownStage } from "./markdown"
import { Card } from "./card"
import { Accordion } from "./accordion"
import { StickyAccordionHeader } from "./sticky-accordion-header"
import { DiffChanges } from "./diff-changes"
import { Icon } from "./icon"
import { TextShimmer } from "./text-shimmer"
import { SessionRetry } from "./session-retry"
import { TextReveal } from "./text-reveal"
import { createAutoScroll, suppressAutoScrollResize } from "../hooks"
import { useI18n } from "../context/i18n"
import { hiddenReasoning } from "./session-turn-state"
import { isCustomHookTool, normalizeTool } from "./tool-meta"

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

type SummaryDiff = SnapshotFileDiff & { file: string }

function summaryDiff(value: SnapshotFileDiff): value is SummaryDiff {
  return typeof value.file === "string"
}

const hidden = new Set(["todowrite"])

function text(value: unknown) {
  if (typeof value !== "string") return
  const next = value.trim()
  if (!next) return
  return next
}

function toolName(part: Extract<PartType, { type: "tool" }>) {
  return normalizeTool(part.tool)
}

function custom(part: PartType) {
  if (part.type !== "tool") return false
  const metadata = part.state.status === "pending" ? {} : (part.state.metadata ?? {})
  const input = part.state.input ?? {}
  return isCustomHookTool(part.tool, input, metadata)
}

function partState(part: PartType, showReasoningSummaries: boolean, showCustomHookParts: boolean) {
  if (part.type === "tool") {
    const tool = toolName(part)
    if (hidden.has(tool)) return
    if (!showCustomHookParts && custom(part)) return
    if (tool === "question" && part.state.status === "pending") return
    return "visible" as const
  }
  if (part.type === "text") return part.text?.trim() ? ("visible" as const) : undefined
  if (part.type === "reasoning") {
    if (showReasoningSummaries && part.text?.trim()) return "visible" as const
    return
  }
  if (PART_MAPPING[part.type]) return "visible" as const
  return
}

function ghost(parts: PartType[]) {
  return !parts.some((part) => {
    if (part.type === "step-start" || part.type === "step-finish") return false
    if (part.type === "reasoning") return false
    if (part.type === "text") return !!part.text?.trim()
    if (part.type === "tool") return true
    return !!PART_MAPPING[part.type]
  })
}

function clean(value: string) {
  return value
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_~]+/g, "")
    .trim()
}

function heading(text: string) {
  const markdown = text.replace(/\r\n?/g, "\n")

  const html = markdown.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i)
  if (html?.[1]) {
    const value = clean(html[1].replace(/<[^>]+>/g, " "))
    if (value) return value
  }

  const atx = markdown.match(/^\s{0,3}#{1,6}[ \t]+(.+?)(?:[ \t]+#+[ \t]*)?$/m)
  if (atx?.[1]) {
    const value = clean(atx[1])
    if (value) return value
  }

  const setext = markdown.match(/^([^\n]+)\n(?:=+|-+)\s*$/m)
  if (setext?.[1]) {
    const value = clean(setext[1])
    if (value) return value
  }

  const strong = markdown.match(/^\s*(?:\*\*|__)(.+?)(?:\*\*|__)\s*$/m)
  if (strong?.[1]) {
    const value = clean(strong[1])
    if (value) return value
  }
}

export function SessionTurn(
  props: ParentProps<{
    sessionID: string
    messageID: string
    messages?: MessageType[]
    actions?: UserActions
    showReasoningSummaries?: boolean
    showCustomHookParts?: boolean
    shellToolDefaultOpen?: boolean
    editToolDefaultOpen?: boolean
    markdownEager?: boolean
    markdownViewport?: HTMLDivElement
    markdownHighlight?: "full" | "defer"
    markdownMath?: "full" | "defer"
    markdownStage?: MarkdownStage
    onMarkdownStage?: (key: string, stage: MarkdownStage | undefined) => void
    active?: boolean
    status?: SessionStatus
    onUserInteracted?: () => void
    autoScroll?: boolean
    fill?: boolean
    classes?: {
      root?: string
      content?: string
      container?: string
    }
  }>,
) {
  const data = useData()
  const i18n = useI18n()
  const fileComponent = useFileComponent()

  const emptyMessages: MessageType[] = []
  const emptyParts: PartType[] = []
  const emptyAssistant: AssistantMessage[] = []
  const emptyDiffs: SummaryDiff[] = []
  const idle = { type: "idle" as const }

  const allMessages = createMemo(() => props.messages ?? list(data.store.message?.[props.sessionID], emptyMessages))

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

  const status = createMemo(() => {
    if (props.status !== undefined) return props.status
    if (typeof props.active === "boolean" && !props.active) return idle
    return data.store.session_status[props.sessionID] ?? idle
  })

  const pending = createMemo(() => {
    if (typeof props.active === "boolean" && typeof props.queued === "boolean") return
    const busy = status().type !== "idle"
    const messages = allMessages() ?? emptyMessages
    return messages.findLast((item): item is AssistantMessage => {
      if (item.role !== "assistant") return false
      if (typeof item.time.completed === "number") return false
      if (busy) return true
      return !ghost(list(data.store.part?.[item.id], emptyParts))
    })
  })

  const pendingUser = createMemo(() => {
    const item = pending()
    if (!item?.parentID) return
    const messages = allMessages() ?? emptyMessages
    const result = Binary.search(messages, item.parentID, (m) => m.id)
    const msg = result.found ? messages[result.index] : messages.find((m) => m.id === item.parentID)
    if (!msg || msg.role !== "user") return
    return msg
  })

  const active = createMemo(() => {
    if (typeof props.active === "boolean") return props.active
    const msg = message()
    const parent = pendingUser()
    if (!msg || !parent) return false
    return parent.id === msg.id
  })

  const parts = createMemo(() => {
    const msg = message()
    if (!msg) return emptyParts
    return list(data.store.part?.[msg.id], emptyParts)
  })

  const compaction = createMemo(() => parts().find((part) => part.type === "compaction"))

  const diffs = createMemo(() => {
    const files = message()?.summary?.diffs
    if (!files?.length) return emptyDiffs

    const seen = new Set<string>()
    return files
      .reduceRight<SummaryDiff[]>((result, diff) => {
        if (!summaryDiff(diff)) return result
        if (seen.has(diff.file)) return result
        seen.add(diff.file)
        result.push(diff)
        return result
      }, [])
      .reverse()
  })
  const MAX_FILES = 10
  const edited = createMemo(() => diffs().length)
  const [open, setOpen] = createSignal(false)
  const [expanded, setExpanded] = createSignal<string[]>([])
  const onOpenChange = (value: boolean) => {
    suppressAutoScrollResize()
    setOpen(value)
  }

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
      if (messageIndex() < 0) return emptyAssistant

      const result: AssistantMessage[] = []
      for (let i = 0; i < messages.length; i++) {
        const item = messages[i]
        if (!item) continue
        if (item.role === "assistant" && item.parentID === msg.id) result.push(item as AssistantMessage)
      }
      return result
    },
    emptyAssistant,
    { equals: same },
  )
  const assistantList = () => assistantMessages() ?? emptyAssistant

  const interrupted = createMemo(() => assistantList().some((m) => m.error?.name === "MessageAbortedError"))
  const divider = createMemo(() => {
    if (compaction()) return i18n.t("ui.messagePart.compaction")
    if (interrupted()) return i18n.t("ui.message.interrupted")
    return ""
  })
  const error = createMemo(() => assistantList().find((m) => m.error && m.error.name !== "MessageAbortedError")?.error)
  const errorText = createMemo(() => {
    const msg = error()?.data?.message
    if (typeof msg === "string") return unwrap(msg)
    if (msg === undefined || msg === null) return ""
    // oxlint-disable-next-line no-base-to-string -- msg is unknown from error data, coercion is intentional
    return unwrap(String(msg))
  })

  // Debounced working state to prevent flashing when status and time.completed update out of sync
  const [stableWorking, setStableWorking] = createSignal(false)
  let workingDebounceTimer: ReturnType<typeof setTimeout> | undefined

  createEffect(() => {
    const isWorking = status().type !== "idle" && active()

    if (isWorking) {
      // Immediately enter working state
      if (workingDebounceTimer) {
        clearTimeout(workingDebounceTimer)
        workingDebounceTimer = undefined
      }
      setStableWorking(true)
    } else {
      // Delay exiting working state to avoid flashing during async state updates
      if (workingDebounceTimer) clearTimeout(workingDebounceTimer)
      workingDebounceTimer = setTimeout(() => {
        setStableWorking(false)
        workingDebounceTimer = undefined
      }, 200)
    }
  })

  onCleanup(() => {
    if (workingDebounceTimer) {
      clearTimeout(workingDebounceTimer)
      workingDebounceTimer = undefined
    }
  })

  const working = createMemo(() => stableWorking())
  const showReasoningSummaries = createMemo(() => props.showReasoningSummaries ?? true)
  const assistantSummary = createMemo(() => {
    let copy: string | undefined
    let visible = 0
    let headingText: string | undefined
    let end: number | undefined

    for (const message of assistantList()) {
      const completed = message.time.completed
      if (typeof completed === "number") end = end === undefined ? completed : Math.max(end, completed)

      const parts = list(data.store.part?.[message.id], emptyParts)
      for (const part of parts) {
        const state = partState(part, showReasoningSummaries(), props.showCustomHookParts ?? true)
        if (state !== "visible") continue
        visible++
        if (part.type === "text" && part.text?.trim()) copy = part.id
        if (part.type === "reasoning") {
          const value = heading(part.text)
          if (value) headingText = value
        }
      }
    }

    return { copy, visible, headingText, end }
  })
  const summary = () => assistantSummary() ?? { copy: undefined, visible: 0, headingText: undefined, end: undefined }

  const assistantCopyPartID = createMemo(() => {
    if (working()) return null
    return summary().copy ?? null
  })
  const turnDurationMs = createMemo(() => {
    const start = message()?.time.created
    if (typeof start !== "number") return undefined

    const end = summary().end

    if (typeof end !== "number") return undefined
    if (end < start) return undefined
    return end - start
  })
  const showThinking = createMemo(() => {
    if (!!error()) return false
    if (summary().visible > 0) return false
    if (working()) {
      if (status().type === "retry") return false
      if (showReasoningSummaries()) return summary().visible === 0
      return true
    }
    return hiddenReasoning(assistantList(), data.store.part ?? {}, showReasoningSummaries())
  })

  const autoScroll = createAutoScroll({
    working,
    onUserInteracted: props.onUserInteracted,
    overflowAnchor: "dynamic",
  })
  const turnAutoScroll = () => props.autoScroll ?? true
  const turnFill = () => props.fill ?? true

  return (
    <div
      data-component="session-turn"
      class={props.classes?.root}
      style={
        turnFill()
          ? undefined
          : {
              height: "auto",
              "min-height": "0",
              display: "block",
            }
      }
    >
      <div
        ref={turnAutoScroll() ? autoScroll.scrollRef : undefined}
        onScroll={turnAutoScroll() ? autoScroll.handleScroll : undefined}
        data-slot="session-turn-content"
        class={props.classes?.content}
        style={
          turnFill()
            ? undefined
            : {
                height: "auto",
                "min-height": "0",
                overflow: "visible",
              }
        }
      >
        <div onClick={turnAutoScroll() ? autoScroll.handleInteraction : undefined}>
          <Show when={message()}>
            {(msg) => (
              <div
                ref={turnAutoScroll() ? autoScroll.contentRef : undefined}
                data-message={msg().id}
                data-slot="session-turn-message-container"
                class={props.classes?.container}
              >
                <div data-slot="session-turn-message-content" aria-live="off">
                  <Message
                    message={msg()}
                    parts={parts()}
                    interrupted={interrupted()}
                    showReasoningSummaries={showReasoningSummaries()}
                    showCustomHookParts={props.showCustomHookParts}
                    markdownEager={props.markdownEager}
                    markdownViewport={props.markdownViewport}
                    markdownHighlight={props.markdownHighlight}
                    markdownMath={props.markdownMath}
                    markdownStage={props.markdownStage}
                    onMarkdownStage={props.onMarkdownStage}
                  />
                </div>
                <Show when={compaction()}>
                  {(part) => (
                    <div data-slot="session-turn-compaction">
                      <Part
                        part={part()}
                        message={msg()}
                        hideDetails
                        markdownEager={props.markdownEager}
                        markdownViewport={props.markdownViewport}
                        markdownHighlight={props.markdownHighlight}
                        markdownMath={props.markdownMath}
                        markdownStage={props.markdownStage}
                        onMarkdownStage={props.onMarkdownStage}
                      />
                    </div>
                  )}
                </Show>
                <Show when={assistantList().length > 0}>
                  <div data-slot="session-turn-assistant-content">
                    <AssistantParts
                      messages={assistantList()}
                      showAssistantCopyPartID={assistantCopyPartID()}
                      turnDurationMs={turnDurationMs()}
                      working={working()}
                      showReasoningSummaries={showReasoningSummaries()}
                      showCustomHookParts={props.showCustomHookParts}
                      shellToolDefaultOpen={props.shellToolDefaultOpen}
                      editToolDefaultOpen={props.editToolDefaultOpen}
                      markdownEager={props.markdownEager}
                      markdownViewport={props.markdownViewport}
                      markdownHighlight={props.markdownHighlight}
                      markdownMath={props.markdownMath}
                      markdownStage={props.markdownStage}
                      onMarkdownStage={props.onMarkdownStage}
                    />
                  </div>
                </Show>
                <SessionRetry status={status()} show={active()} />
                <Show when={edited() > 0 && !working()}>
                  <div data-slot="session-turn-diffs">
                    <Collapsible open={open()} onOpenChange={onOpenChange} variant="ghost">
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
                              style={{ "--sticky-accordion-offset": "40px" }}
                              value={expanded()}
                              onChange={(value) =>
                                setState("expanded", Array.isArray(value) ? value : value ? [value] : [])
                              }
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
                                      <StickyAccordionHeader>
                                        <Accordion.Trigger>
                                          <div data-slot="session-turn-diff-trigger">
                                            <span data-slot="session-turn-diff-path">
                                              <Show when={diff.file.includes("/")}>
                                                <span data-slot="session-turn-diff-directory">
                                                  {`\u202A${getDirectory(diff.file)}\u202C`}
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
                                      </StickyAccordionHeader>
                                      <Accordion.Content>
                                        <Show when={visible()}>
                                          <div data-slot="session-turn-diff-view" data-scrollable>
                                            <Dynamic
                                              component={fileComponent}
                                              mode="diff"
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
                <Show when={showThinking()}>
                  <div data-slot="session-turn-thinking">
                    <Show
                      when={working()}
                      fallback={<span>{i18n.t("ui.messagePart.reasoning.thought")}</span>}
                    >
                      <TextShimmer text={i18n.t("ui.sessionTurn.status.thinking")} />
                    </Show>
                    <Show when={!showReasoningSummaries()}>
                      <Show
                        when={working()}
                        fallback={<span class="session-turn-thinking-heading">{summary().headingText}</span>}
                      >
                        <TextReveal
                          text={summary().headingText}
                          class="session-turn-thinking-heading"
                          travel={25}
                          duration={700}
                        />
                      </Show>
                    </Show>
                  </div>
                </Show>
              </div>
              <Show when={divider()}>
                <div data-slot="session-turn-compaction">
                  <MessageDivider label={divider()} />
                </div>
              </Show>
              <Show when={assistantMessages().length > 0}>
                <div data-slot="session-turn-assistant-content" aria-hidden={working()}>
                  <AssistantParts
                    messages={assistantMessages()}
                    showAssistantCopyPartID={assistantCopyPartID()}
                    turnDurationMs={turnDurationMs()}
                    working={working()}
                    showReasoningSummaries={showReasoningSummaries()}
                    shellToolDefaultOpen={props.shellToolDefaultOpen}
                    editToolDefaultOpen={props.editToolDefaultOpen}
                  />
                </div>
              </Show>
              <Show when={showThinking()}>
                <div data-slot="session-turn-thinking">
                  <TextShimmer text={i18n.t("ui.sessionTurn.status.thinking")} />
                  <Show when={!showReasoningSummaries()}>
                    <TextReveal
                      text={reasoningHeading()}
                      class="session-turn-thinking-heading"
                      travel={25}
                      duration={700}
                    />
                  </Show>
                </div>
              </Show>
              <SessionRetry status={status()} show={active()} />
              <Show when={edited() > 0 && !working()}>
                <div
                  data-slot="session-turn-diffs"
                  data-component="session-turn-diffs-group"
                  data-show-all={showAll() || undefined}
                >
                  <div data-slot="session-turn-diffs-header">
                    <span data-slot="session-turn-diffs-label">
                      {edited()} {i18n.t("ui.sessionTurn.diffs.changed")}{" "}
                      {i18n.t(edited() === 1 ? "ui.common.file.one" : "ui.common.file.other")}
                    </span>
                    <DiffChanges changes={diffs()} />
                    <Show when={overflow() > 0}>
                      <span data-slot="session-turn-diffs-toggle" onClick={toggleAll}>
                        {showAll() ? i18n.t("ui.sessionTurn.diffs.showLess") : i18n.t("ui.sessionTurn.diffs.showAll")}
                      </span>
                    </Show>
                  </div>
                  <div data-component="session-turn-diffs-content">
                    <Accordion
                      multiple
                      style={{ "--sticky-accordion-offset": "44px" }}
                      value={expanded()}
                      onChange={(value) => setState("expanded", Array.isArray(value) ? value : value ? [value] : [])}
                    >
                      <For each={visible()}>
                        {(diff) => {
                          const view = normalize(diff)
                          const active = createMemo(() => expanded().includes(diff.file))
                          const [shown, setShown] = createSignal(false)

                          createEffect(
                            on(
                              active,
                              (value) => {
                                if (!value) {
                                  setShown(false)
                                  return
                                }

                                requestAnimationFrame(() => {
                                  if (!active()) return
                                  setShown(true)
                                })
                              },
                              { defer: true },
                            ),
                          )

                          return (
                            <Accordion.Item value={diff.file}>
                              <StickyAccordionHeader>
                                <Accordion.Trigger>
                                  <div data-slot="session-turn-diff-trigger">
                                    <span data-slot="session-turn-diff-path">
                                      <Show when={diff.file.includes("/")}>
                                        <span data-slot="session-turn-diff-directory">
                                          {`\u202A${getDirectory(diff.file)}\u202C`}
                                        </span>
                                      </Show>
                                      <span data-slot="session-turn-diff-filename">{getFilename(diff.file)}</span>
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
                              </StickyAccordionHeader>
                              <Accordion.Content>
                                <Show when={shown()}>
                                  <div data-slot="session-turn-diff-view" data-scrollable>
                                    <Dynamic component={fileComponent} mode="diff" fileDiff={view.fileDiff} />
                                  </div>
                                </Show>
                              </Accordion.Content>
                            </Accordion.Item>
                          )
                        }}
                      </For>
                    </Accordion>
                    <Show when={!showAll() && overflow() > 0}>
                      <div data-slot="session-turn-diffs-more" onClick={toggleAll}>
                        {i18n.t("ui.sessionTurn.diffs.more", { count: String(overflow()) })}
                      </div>
                    </Show>
                  </div>
                </div>
              </Show>
              <Show when={error()}>
                <Card variant="error" class="error-card">
                  {errorText()}
                </Card>
              </Show>
            </div>
          </Show>
          {props.children}
        </div>
      </div>
    </div>
  )
}
