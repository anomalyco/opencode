import { AssistantMessage } from "@opencode-ai/sdk/v2"
import { useData } from "../context"
import { useDiffComponent } from "../context/diff"
import { getDirectory, getFilename } from "@opencode-ai/util/path"
import { checksum } from "@opencode-ai/util/encode"
import { createEffect, createMemo, createSignal, For, Match, onCleanup, ParentProps, Show, Switch } from "solid-js"
import { DiffChanges } from "./diff-changes"
import { Typewriter } from "./typewriter"
import { Message } from "./message-part"
import { Markdown } from "./markdown"
import { Accordion } from "./accordion"
import { StickyAccordionHeader } from "./sticky-accordion-header"
import { FileIcon } from "./file-icon"
import { Icon } from "./icon"
import { Card } from "./card"
import { MessageProgress } from "./message-progress"
import { Collapsible } from "./collapsible"
import { Dynamic } from "solid-js/web"

// Track animation state per message ID - persists across re-renders
// "empty" = first saw with no value (should animate when value arrives)
// "animating" = currently animating (keep returning true)
// "done" = already animated or first saw with value (never animate)
const titleAnimationState = new Map<string, "empty" | "animating" | "done">()
const summaryAnimationState = new Map<string, "empty" | "animating" | "done">()

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
  const sanitizer = createMemo(() => (data.directory ? new RegExp(`${data.directory}/`, "g") : undefined))
  const messages = createMemo(() => (props.sessionID ? (data.store.message[props.sessionID] ?? []) : []))
  const userMessages = createMemo(() =>
    messages()
      .filter((m) => m.role === "user")
      .sort((a, b) => a.id.localeCompare(b.id)),
  )
  const lastUserMessage = createMemo(() => {
    return userMessages()?.at(-1)
  })
  const message = createMemo(() => userMessages()?.find((m) => m.id === props.messageID))

  const status = createMemo(
    () =>
      data.store.session_status[props.sessionID] ?? {
        type: "idle",
      },
  )
  const working = createMemo(() => status()?.type !== "idle")

  return (
    <div data-component="session-turn" class={props.classes?.root}>
      <div data-slot="session-turn-content" class={props.classes?.content}>
        <Show when={message()}>
          {(msg) => {
            const [detailsExpanded, setDetailsExpanded] = createSignal(false)

            // Animation logic: only animate if we witness the value transition from empty to non-empty
            // Track in module-level Maps keyed by message ID so it persists across re-renders

            // Initialize animation state for current message (reactive - runs when msg().id changes)
            createEffect(() => {
              const id = msg().id
              if (!titleAnimationState.has(id)) {
                titleAnimationState.set(id, msg().summary?.title ? "done" : "empty")
              }
              if (!summaryAnimationState.has(id)) {
                const assistantMsgs = messages()?.filter(
                  (m) => m.role === "assistant" && m.parentID == id,
                ) as AssistantMessage[]
                const parts = assistantMsgs?.flatMap((m) => data.store.part[m.id])
                const lastText = parts?.filter((p) => p?.type === "text")?.at(-1)
                const summaryValue = msg().summary?.body ?? lastText?.text
                summaryAnimationState.set(id, summaryValue ? "done" : "empty")
              }

              // When message changes or component unmounts, mark any "animating" states as "done"
              onCleanup(() => {
                if (titleAnimationState.get(id) === "animating") {
                  titleAnimationState.set(id, "done")
                }
                if (summaryAnimationState.get(id) === "animating") {
                  summaryAnimationState.set(id, "done")
                }
              })
            })

            const assistantMessages = createMemo(() => {
              return messages()?.filter((m) => m.role === "assistant" && m.parentID == msg().id) as AssistantMessage[]
            })
            const assistantMessageParts = createMemo(() => assistantMessages()?.flatMap((m) => data.store.part[m.id]))
            const error = createMemo(() => assistantMessages().find((m) => m?.error)?.error)
            const parts = createMemo(() => data.store.part[msg().id])
            const lastTextPart = createMemo(() =>
              assistantMessageParts()
                .filter((p) => p?.type === "text")
                ?.at(-1),
            )
            const hasToolPart = createMemo(() => assistantMessageParts().some((p) => p?.type === "tool"))
            const messageWorking = createMemo(() => msg().id === lastUserMessage()?.id && working())
            const initialCompleted = !(msg().id === lastUserMessage()?.id && working())
            const [completed, setCompleted] = createSignal(initialCompleted)
            const summary = createMemo(() => msg().summary?.body ?? lastTextPart()?.text)
            const lastTextPartShown = createMemo(() => !msg().summary?.body && (lastTextPart()?.text?.length ?? 0) > 0)

            // Should animate: state is "empty" AND value now exists, or state is "animating"
            // Transition: empty -> animating -> done (done happens on cleanup)
            const animateTitle = createMemo(() => {
              const id = msg().id
              const state = titleAnimationState.get(id)
              const title = msg().summary?.title
              if (state === "animating") {
                return true
              }
              if (state === "empty" && title) {
                titleAnimationState.set(id, "animating")
                return true
              }
              return false
            })
            const animateSummary = createMemo(() => {
              const id = msg().id
              const state = summaryAnimationState.get(id)
              const value = summary()
              if (state === "animating") {
                return true
              }
              if (state === "empty" && value) {
                summaryAnimationState.set(id, "animating")
                return true
              }
              return false
            })

            createEffect(() => {
              const done = !messageWorking()
              setTimeout(() => setCompleted(done), 1200)
            })

            return (
              <div data-message={msg().id} data-slot="session-turn-message-container" class={props.classes?.container}>
                {/* Title */}
                <div data-slot="session-turn-message-header">
                  <div data-slot="session-turn-message-title">
                    <Show
                      when={!animateTitle()}
                      fallback={<Typewriter as="h1" text={msg().summary?.title} data-slot="session-turn-typewriter" />}
                    >
                      <h1>{msg().summary?.title}</h1>
                    </Show>
                  </div>
                </div>
                <div data-slot="session-turn-message-content">
                  <Message message={msg()} parts={parts()} sanitize={sanitizer()} />
                </div>
                {/* Summary */}
                <Show when={completed()}>
                  <div data-slot="session-turn-summary-section">
                    <div data-slot="session-turn-summary-header">
                      <h2 data-slot="session-turn-summary-title">
                        <Switch>
                          <Match when={msg().summary?.diffs?.length}>Summary</Match>
                          <Match when={true}>Response</Match>
                        </Switch>
                      </h2>
                      <Show when={summary()}>
                        {(summary) => (
                          <Markdown
                            data-slot="session-turn-markdown"
                            data-diffs={!!msg().summary?.diffs?.length}
                            data-fade={!msg().summary?.diffs?.length && animateSummary()}
                            text={summary()}
                          />
                        )}
                      </Show>
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
                <Show when={error() && !detailsExpanded()}>
                  <Card variant="error" class="error-card">
                    {error()?.data?.message as string}
                  </Card>
                </Show>
                {/* Response */}
                <div data-slot="session-turn-response-section">
                  <Switch>
                    <Match when={!completed()}>
                      <MessageProgress assistantMessages={assistantMessages} done={!messageWorking()} />
                    </Match>
                    <Match when={completed() && hasToolPart()}>
                      <Collapsible variant="ghost" open={detailsExpanded()} onOpenChange={setDetailsExpanded}>
                        <Collapsible.Trigger>
                          <div data-slot="session-turn-collapsible-trigger-content">
                            <div data-slot="session-turn-details-text">
                              <Switch>
                                <Match when={detailsExpanded()}>Hide details</Match>
                                <Match when={!detailsExpanded()}>Show details</Match>
                              </Switch>
                            </div>
                            <Collapsible.Arrow />
                          </div>
                        </Collapsible.Trigger>
                        <Collapsible.Content>
                          <div data-slot="session-turn-collapsible-content-inner">
                            <For each={assistantMessages()}>
                              {(assistantMessage) => {
                                const parts = createMemo(() => data.store.part[assistantMessage.id])
                                const last = createMemo(() =>
                                  parts()
                                    .filter((p) => p?.type === "text")
                                    .at(-1),
                                )
                                if (lastTextPartShown() && lastTextPart()?.id === last()?.id) {
                                  return (
                                    <Message
                                      message={assistantMessage}
                                      parts={parts().filter((p) => p?.id !== last()?.id)}
                                      sanitize={sanitizer()}
                                    />
                                  )
                                }
                                return <Message message={assistantMessage} parts={parts()} sanitize={sanitizer()} />
                              }}
                            </For>
                            <Show when={error()}>
                              <Card variant="error" class="error-card">
                                {error()?.data?.message as string}
                              </Card>
                            </Show>
                          </div>
                        </Collapsible.Content>
                      </Collapsible>
                    </Match>
                  </Switch>
                </div>
              </div>
            )
          }}
        </Show>
        {props.children}
      </div>
    </div>
  )
}
