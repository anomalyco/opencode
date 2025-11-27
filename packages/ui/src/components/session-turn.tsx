import { AssistantMessage } from "@opencode-ai/sdk"
import { useData } from "../context"
import { Binary } from "@opencode-ai/util/binary"
import { getDirectory, getFilename } from "@opencode-ai/util/path"
import { createEffect, createMemo, createSignal, For, Match, onMount, ParentProps, Show, Switch } from "solid-js"
import { DiffChanges } from "./diff-changes"
import { Typewriter } from "./typewriter"
import { Message } from "./message-part"
import { Markdown } from "./markdown"
import { Accordion } from "./accordion"
import { StickyAccordionHeader } from "./sticky-accordion-header"
import { FileIcon } from "./file-icon"
import { Icon } from "./icon"
import { Diff } from "./diff"
import { Card } from "./card"
import { MessageProgress } from "./message-progress"
import { Collapsible } from "./collapsible"

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
  const match = Binary.search(data.store.session, props.sessionID, (s) => s.id)
  if (!match.found) throw new Error(`Session ${props.sessionID} not found`)

  const sanitizer = createMemo(() => (data.directory ? new RegExp(`${data.directory}/`, "g") : undefined))
  const messages = createMemo(() => (props.sessionID ? (data.store.message[props.sessionID] ?? []) : []))
  const userMessages = createMemo(() =>
    messages()
      .filter((m) => m.role === "user")
      .sort((a, b) => b.id.localeCompare(a.id)),
  )
  const lastUserMessage = createMemo(() => {
    return userMessages()?.at(0)
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
            const titleKey = `app:seen:session:${props.sessionID}:${msg().id}:title`
            const contentKey = `app:seen:session:${props.sessionID}:${msg().id}:content`
            const [detailsExpanded, setDetailsExpanded] = createSignal(false)
            const [titled, setTitled] = createSignal(true)
            const [faded, setFaded] = createSignal(true)

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

            // allowing time for the animations to finish
            onMount(() => {
              const titleSeen = sessionStorage.getItem(titleKey) === "true"
              const contentSeen = sessionStorage.getItem(contentKey) === "true"

              if (!titleSeen) {
                setTitled(false)
                const title = msg().summary?.title
                if (title) setTimeout(() => setTitled(true), 10_000)
                setTimeout(() => sessionStorage.setItem(titleKey, "true"), 1000)
              }

              if (!contentSeen) {
                setFaded(false)
                setTimeout(() => sessionStorage.setItem(contentKey, "true"), 1000)
              }
            })

            createEffect(() => {
              const completed = !messageWorking()
              setTimeout(() => setCompleted(completed), 1200)
            })

            return (
              <div data-message={msg().id} data-slot="session-turn-message-container" class={props.classes?.container}>
                {/* Title */}
                <div data-slot="session-turn-message-header">
                  <div data-slot="session-turn-message-title">
                    <Show
                      when={titled()}
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
                            data-fade={!msg().summary?.diffs?.length && !faded()}
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
                              <Diff
                                before={{
                                  name: diff.file!,
                                  contents: diff.before!,
                                }}
                                after={{
                                  name: diff.file!,
                                  contents: diff.after!,
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
