import { createMemo, onCleanup, onMount, Show } from "solid-js"
import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { ScrollView } from "@opencode/ui/scroll-view"
import { Textarea } from "@opencode/ui/textarea"
import { Tooltip } from "@opencode/ui/tooltip"
import { SessionTimeline } from "@opencode/session-ui/timeline"
import { createKeyed, useExtension, type MountedSession } from "../sdk"
import type { SideChatModel } from "./model"
import { ownMessages } from "./transcript"

export default function SideChatPanel(props: { chats: SideChatModel; session: MountedSession; id: string }) {
  const ctx = useExtension()
  const chat = () => props.chats.entry(props.session, props.id)
  const data = () => props.session.server.data
  const sessionID = () => chat()?.sessionID

  const running = () => {
    const id = sessionID()

    return !!id && data().session.status(id) === "running"
  }

  const messages = createMemo(() => {
    const current = chat()

    return current ? ownMessages(data().session.message.list(current.sessionID), current.base) : []
  })

  let scroller: HTMLDivElement | undefined
  let content: HTMLDivElement | undefined
  // Follows new output only while the reader is at the bottom.
  let pinned = true

  createKeyed(sessionID, (id) => {
    void Promise.all([data().session.message.sync(id), data().session.pending.sync(id)]).catch(() => undefined)
  })

  const toBottom = () => {
    if (pinned && scroller) scroller.scrollTop = scroller.scrollHeight
  }

  onMount(() => {
    if (!content) return

    const observer = new ResizeObserver(toBottom)
    observer.observe(content)
    onCleanup(() => observer.disconnect())
    toBottom()
  })

  const send = () => props.chats.send(props.session, props.id, props.chats.draft(props.id))

  const submitOnEnter = (event: KeyboardEvent) => {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing || event.keyCode === 229) return
    event.preventDefault()
    send()
  }

  const keepSelection = (event: MouseEvent) => event.preventDefault()

  const quote = () => {
    const text = window.getSelection()?.toString() ?? ""

    props.chats.quote(props.session, props.id, text)
  }

  return (
    <div class="flex h-full min-h-0 flex-col bg-v2-background-bg-base" data-slot="session-side-chat-panel">
      <div class="relative min-h-0 flex-1">
        <Show
          when={sessionID()}
          fallback={<div class="px-5 py-4 text-13-regular text-text-weak">{ctx.t("loading")}</div>}
        >
          {(id) => (
            <ScrollView
              class="absolute inset-0"
              viewportRef={(element) => {
                scroller = element
                element.addEventListener(
                  "scroll",
                  () => (pinned = element.scrollHeight - element.scrollTop - element.clientHeight < 24),
                  { passive: true },
                )
              }}
            >
              <div ref={content} class="px-3 py-4">
                <Show
                  when={messages().length > 0}
                  fallback={
                    <div class="mx-auto max-w-64 px-5 pt-16 text-center text-13-regular text-text-weak">
                      {ctx.t("empty.hint")}
                    </div>
                  }
                >
                  <SessionTimeline
                    document={{
                      sessionID: id(),
                      messages: messages(),
                      status: running() ? { type: "busy" } : { type: "idle" },
                      diffs: [],
                    }}
                  />
                </Show>
              </div>
            </ScrollView>
          )}
        </Show>
      </div>

      <div class="flex shrink-0 flex-col gap-2 border-t border-v2-border-border-base p-3">
        <Textarea
          rows={2}
          value={props.chats.draft(props.id)}
          placeholder={ctx.t("composer.placeholder")}
          aria-label={ctx.t("composer.placeholder")}
          onInput={(event) => props.chats.setDraft(props.id, event.currentTarget.value)}
          onKeyDown={submitOnEnter}
        />
        <div class="flex items-center justify-between gap-2">
          {/* Keeps the selection alive while the button takes the press. */}
          <Button size="small" variant="ghost-muted" onMouseDown={keepSelection} onClick={quote}>
            {ctx.t("quote.action")}
          </Button>
          <Show
            when={running()}
            fallback={
              <Tooltip value={ctx.t("composer.send")}>
                <IconButton
                  size="small"
                  variant="submit"
                  icon={<Icon name="arrow-up" />}
                  aria-label={ctx.t("composer.send")}
                  disabled={!props.chats.draft(props.id).trim()}
                  onClick={send}
                />
              </Tooltip>
            }
          >
            <Tooltip value={ctx.t("composer.stop")}>
              <IconButton
                size="small"
                variant="neutral"
                icon={<Icon name="stop" />}
                aria-label={ctx.t("composer.stop")}
                onClick={() => props.chats.stop(props.session, props.id)}
              />
            </Tooltip>
          </Show>
        </div>
      </div>
    </div>
  )
}
