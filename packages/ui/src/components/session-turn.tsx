import { AssistantMessage, ToolPart } from "@opencode-ai/sdk/v2/client"
import { useData } from "../context"
import { useDiffComponent } from "../context/diff"
import { getDirectory, getFilename } from "@opencode-ai/util/path"
import { checksum } from "@opencode-ai/util/encode"
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  onCleanup,
  onMount,
  ParentProps,
  Show,
  Switch,
} from "solid-js"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { DiffChanges } from "./diff-changes"
import { Typewriter } from "./typewriter"
import { Message } from "./message-part"
import { Markdown } from "./markdown"
import { Accordion } from "./accordion"
import { StickyAccordionHeader } from "./sticky-accordion-header"
import { FileIcon } from "./file-icon"
import { Icon } from "./icon"
import { Card } from "./card"
import { Collapsible } from "./collapsible"
import { Dynamic } from "solid-js/web"
import { Button } from "./button"
import { Spinner } from "./spinner"
import { createStore } from "solid-js/store"
import { DateTime, DurationUnit, Interval } from "luxon"

export function SessionTurn(
  props: ParentProps<{
    sessionID: string
    messageID: string
    classes?: {
      root?: string
      content?: string
      container?: string
    }
  }>,
) {
  const data = useData()
  const diffComponent = useDiffComponent()
  const messages = createMemo(() => (props.sessionID ? (data.store.message[props.sessionID] ?? []) : []))
  const userMessages = createMemo(() =>
    messages()
      .filter((m) => m.role === "user")
      .sort((a, b) => a.id.localeCompare(b.id)),
  )
  const message = createMemo(() => userMessages()?.find((m) => m.id === props.messageID))
  const status = createMemo(
    () =>
      data.store.session_status[props.sessionID] ?? {
        type: "idle",
      },
  )
  const working = createMemo(() => status()?.type !== "idle")

  let scrollRef: HTMLDivElement | undefined
  let contentRef: HTMLDivElement | undefined
  let stickyHeaderRef: HTMLDivElement | undefined
  const [userScrolled, setUserScrolled] = createSignal(false)
  const [stickyHeaderHeight, setStickyHeaderHeight] = createSignal(0)

  function handleScroll() {
    if (!scrollRef) return
    const { scrollTop, scrollHeight, clientHeight } = scrollRef
    const atBottom = scrollHeight - scrollTop - clientHeight < 50
    if (!atBottom && working()) {
      setUserScrolled(true)
    }
  }

  function handleInteraction() {
    if (working()) {
      setUserScrolled(true)
    }
  }

  createEffect(() => {
    if (!working()) {
      setUserScrolled(false)
    }
  })

  onMount(() => {
    if (!contentRef) return
    createResizeObserver(contentRef, () => {
      if (!scrollRef || userScrolled() || !working()) return
      scrollRef.scrollTop = scrollRef.scrollHeight
    })
  })

  onMount(() => {
    if (!stickyHeaderRef) return
    createResizeObserver(stickyHeaderRef, ({ height }) => {
      setStickyHeaderHeight(height + 8)
    })
  })

  return (
    <div data-component="session-turn" class={props.classes?.root}>
      <div ref={scrollRef} onScroll={handleScroll} data-slot="session-turn-content" class={props.classes?.content}>
        <div ref={contentRef} onClick={handleInteraction}>
          <Show when={message()}>
            {(message) => {
              const assistantMessages = createMemo(() => {
                return messages()?.filter(
                  (m) => m.role === "assistant" && m.parentID == message().id,
                ) as AssistantMessage[]
              })
              const lastAssistantMessage = createMemo(() => assistantMessages()?.at(-1))
              const assistantMessageParts = createMemo(() => assistantMessages()?.flatMap((m) => data.store.part[m.id]))
              const error = createMemo(() => assistantMessages().find((m) => m?.error)?.error)
              const parts = createMemo(() => data.store.part[message().id])
              const lastTextPart = createMemo(() =>
                assistantMessageParts()
                  .filter((p) => p?.type === "text")
                  ?.at(-1),
              )
              const summary = createMemo(() => message().summary?.body ?? lastTextPart()?.text)
              const lastTextPartShown = createMemo(
                () => !message().summary?.body && (lastTextPart()?.text?.length ?? 0) > 0,
              )

              const assistantParts = createMemo(() => assistantMessages().flatMap((m) => data.store.part[m.id]))
              const currentTask = createMemo(
                () =>
                  assistantParts().findLast(
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
                let resolved = assistantParts()
                const task = currentTask()
                if (task && task.state && "metadata" in task.state && task.state.metadata?.sessionId) {
                  const messages = data.store.message[task.state.metadata.sessionId as string]?.filter(
                    (m) => m.role === "assistant",
                  )
                  resolved = messages?.flatMap((m) => data.store.part[m.id]) ?? assistantParts()
                }
                return resolved
              })
              const lastPart = createMemo(() => resolvedParts().slice(-1)?.at(0))
              const rawStatus = createMemo(() => {
                const last = lastPart()
                if (!last) return undefined

                if (last.type === "tool") {
                  switch (last.tool) {
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
                      break
                  }
                } else if (last.type === "reasoning") {
                  return "Thinking"
                } else if (last.type === "text") {
                  return "Gathering thoughts"
                }
                return undefined
              })

              function duration() {
                const completed = lastAssistantMessage()?.time.completed
                const from = DateTime.fromMillis(message()!.time.created)
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

              const [store, setStore] = createStore({
                status: rawStatus(),
                detailsExpanded: true,
                duration: duration(),
              })

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

              // Auto-collapse steps when done working (if user hasn't interacted)
              createEffect((prev) => {
                const isWorking = working()
                if (prev && !isWorking && !userScrolled()) {
                  setStore("detailsExpanded", false)
                }
                return isWorking
              }, working())

              return (
                <div
                  data-message={message().id}
                  data-slot="session-turn-message-container"
                  class={props.classes?.container}
                  style={{ "--sticky-header-height": `${stickyHeaderHeight()}px` }}
                >
                  {/* Sticky Header */}
                  <div ref={stickyHeaderRef} data-slot="session-turn-sticky-header">
                    <div data-slot="session-turn-message-header">
                      <div data-slot="session-turn-message-title">
                        <Switch>
                          <Match when={working()}>
                            <Typewriter as="h1" text={message().summary?.title} data-slot="session-turn-typewriter" />
                          </Match>
                          <Match when={true}>
                            <h1>{message().summary?.title}</h1>
                          </Match>
                        </Switch>
                      </div>
                    </div>
                    <div data-slot="session-turn-message-content">
                      <Message message={message()} parts={parts()} />
                    </div>
                    <div data-slot="session-turn-response-trigger">
                      <Button
                        data-slot="session-turn-collapsible-trigger-content"
                        variant="ghost"
                        size="small"
                        onClick={() => setStore("detailsExpanded", !store.detailsExpanded)}
                      >
                        <Show when={working()}>
                          <Spinner />
                        </Show>
                        <Switch>
                          <Match when={working()}>{store.status ?? "Considering next steps..."}</Match>
                          <Match when={store.detailsExpanded}>Hide steps</Match>
                          <Match when={!store.detailsExpanded}>Show steps</Match>
                        </Switch>
                        <span>·</span>
                        <span>{store.duration}</span>
                        <Icon name="chevron-grabber-vertical" size="small" />
                      </Button>
                    </div>
                  </div>
                  {/* Response */}
                  <Show when={store.detailsExpanded}>
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
                              <Match when={lastTextPartShown() && lastTextPart()?.id === last()?.id}>
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
                        <h2 data-slot="session-turn-summary-title">
                          <Switch>
                            <Match when={message().summary?.diffs?.length}>Summary</Match>
                            <Match when={true}>Response</Match>
                          </Switch>
                        </h2>
                        <Show when={summary()}>
                          {(summary) => (
                            <Markdown
                              data-slot="session-turn-markdown"
                              data-diffs={!!message().summary?.diffs?.length}
                              text={summary()}
                            />
                          )}
                        </Show>
                      </div>
                      <Accordion data-slot="session-turn-accordion" multiple>
                        <For each={message().summary?.diffs ?? []}>
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
                                          <span data-slot="session-turn-directory">{getDirectory(diff.file)}&lrm;</span>
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
                  <Show when={error() && !store.detailsExpanded}>
                    <Card variant="error" class="error-card">
                      {error()?.data?.message as string}
                    </Card>
                  </Show>
                </div>
              )
            }}
          </Show>
          {props.children}
        </div>
      </div>
    </div>
  )
}
