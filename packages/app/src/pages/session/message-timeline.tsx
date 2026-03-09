import {
  For,
  Index,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  Show,
  startTransition,
  type JSX,
} from "solid-js"
import { createStore } from "solid-js/store"
import { useParams } from "@solidjs/router"
import { Button } from "@opencode-ai/ui/button"
import { FileIcon } from "@opencode-ai/ui/file-icon"
import { Icon } from "@opencode-ai/ui/icon"
import { SessionTurn } from "@opencode-ai/ui/session-turn"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import type { AssistantMessage, Message as MessageType, Part, TextPart, UserMessage } from "@opencode-ai/sdk/v2"
import { Binary } from "@opencode-ai/util/binary"
import { getFilename } from "@opencode-ai/util/path"
import { shouldMarkBoundaryGesture, normalizeWheelDelta } from "@/pages/session/message-gesture"
import { useLanguage } from "@/context/language"
import { useSettings } from "@/context/settings"
import { useSync } from "@/context/sync"
import { parseCommentNote, readCommentMetadata } from "@/utils/comment-note"
import { SessionTimelineHeader } from "@/pages/session/session-timeline-header"

type MessageComment = {
  path: string
  comment: string
  selection?: {
    startLine: number
    endLine: number
  }
}

const emptyMessages: MessageType[] = []

const isDefaultSessionTitle = (title?: string) =>
  !!title && /^(New session - |Child session - )\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(title)

const messageComments = (parts: Part[]): MessageComment[] =>
  parts.flatMap((part) => {
    if (part.type !== "text" || !(part as TextPart).synthetic) return []
    const next = readCommentMetadata(part.metadata) ?? parseCommentNote(part.text)
    if (!next) return []
    return [
      {
        path: next.path,
        comment: next.comment,
        selection: next.selection
          ? {
              startLine: next.selection.startLine,
              endLine: next.selection.endLine,
            }
          : undefined,
      },
    ]
  })

const boundaryTarget = (root: HTMLElement, target: EventTarget | null) => {
  const current = target instanceof Element ? target : undefined
  const nested = current?.closest("[data-scrollable]")
  if (!nested || nested === root) return root
  if (!(nested instanceof HTMLElement)) return root
  return nested
}

const markBoundaryGesture = (input: {
  root: HTMLDivElement
  target: EventTarget | null
  delta: number
  onMarkScrollGesture: (target?: EventTarget | null) => void
}) => {
  const target = boundaryTarget(input.root, input.target)
  if (target === input.root) {
    input.onMarkScrollGesture(input.root)
    return
  }
  if (
    shouldMarkBoundaryGesture({
      delta: input.delta,
      scrollTop: target.scrollTop,
      scrollHeight: target.scrollHeight,
      clientHeight: target.clientHeight,
    })
  ) {
    input.onMarkScrollGesture(input.root)
  }
}

type StageConfig = {
  init: number
  batch: number
}

type TimelineStageInput = {
  sessionKey: () => string
  turnStart: () => number
  messages: () => UserMessage[]
  config: StageConfig
}

/**
 * Defer-mounts small timeline windows so revealing older turns does not
 * block first paint with a large DOM mount.
 *
 * Once staging completes for a session it never re-stages — backfill and
 * new messages render immediately.
 */
function createTimelineStaging(input: TimelineStageInput) {
  const [state, setState] = createStore({
    activeSession: "",
    completedSession: "",
    count: 0,
  })
  const [readySession, setReadySession] = createSignal("")
  let active = ""

  const stagedCount = createMemo(() => {
    const total = input.messages().length
    if (input.turnStart() <= 0) return total
    if (state.completedSession === input.sessionKey()) return total
    const init = Math.min(total, input.config.init)
    if (state.count <= init) return init
    if (state.count >= total) return total
    return state.count
  })

  const stagedUserMessages = createMemo(() => {
    const list = input.messages()
    const count = stagedCount()
    if (count >= list.length) return list
    return list.slice(Math.max(0, list.length - count))
  })

  let frame: number | undefined
  const cancel = () => {
    if (frame === undefined) return
    cancelAnimationFrame(frame)
    frame = undefined
  }
  const scheduleReady = (sessionKey: string) => {
    if (input.sessionKey() !== sessionKey) return
    if (readySession() === sessionKey) return
    setReadySession(sessionKey)
  }

  createEffect(
    on(
      () => [input.sessionKey(), input.turnStart() > 0, input.messages().length] as const,
      ([sessionKey, isWindowed, total]) => {
        const switched = active !== sessionKey
        if (switched) {
          active = sessionKey
          setReadySession("")
        }

        const staging = state.activeSession === sessionKey && state.completedSession !== sessionKey
        const shouldStage = isWindowed && total > input.config.init && state.completedSession !== sessionKey

        if (staging && !switched && shouldStage && frame !== undefined) return

        cancel()

        if (shouldStage) setReadySession("")
        if (!shouldStage) {
          setState({
            activeSession: "",
            completedSession: isWindowed ? sessionKey : state.completedSession,
            count: total,
          })
          if (total <= 0) {
            setReadySession("")
            return
          }
          if (readySession() !== sessionKey) scheduleReady(sessionKey)
          return
        }

        let count = Math.min(total, input.config.init)
        if (staging) count = Math.min(total, Math.max(count, state.count))
        setState({ activeSession: sessionKey, count })

        const step = () => {
          if (input.sessionKey() !== sessionKey) {
            frame = undefined
            return
          }
          const currentTotal = input.messages().length
          count = Math.min(currentTotal, count + input.config.batch)
          startTransition(() => setState("count", count))
          if (count >= currentTotal) {
            setState({ completedSession: sessionKey, activeSession: "" })
            frame = undefined
            scheduleReady(sessionKey)
            return
          }
          frame = requestAnimationFrame(step)
        }
        frame = requestAnimationFrame(step)
      },
    ),
  )

  const isStaging = createMemo(() => {
    const key = input.sessionKey()
    return state.activeSession === key && state.completedSession !== key
  })
  const ready = createMemo(() => readySession() === input.sessionKey())

  onCleanup(() => {
    cancel()
  })
  return { messages: stagedUserMessages, isStaging, ready }
}

export function MessageTimeline(props: {
  mobileChanges: boolean
  mobileFallback: JSX.Element
  scroll: { overflow: boolean; bottom: boolean }
  onResumeScroll: () => void
  setScrollRef: (el: HTMLDivElement | undefined) => void
  onScheduleScrollState: (el: HTMLDivElement) => void
  onAutoScrollHandleScroll: () => void
  onMarkScrollGesture: (target?: EventTarget | null) => void
  hasScrollGesture: () => boolean
  isDesktop: boolean
  onScrollSpyScroll: () => void
  onTurnBackfillScroll: () => void
  onAutoScrollInteraction: (event: MouseEvent) => void
  onPreserveScrollAnchor: (target: HTMLElement) => void
  centered: boolean
  setContentRef: (el: HTMLDivElement) => void
  turnStart: number
  historyMore: boolean
  historyLoading: boolean
  onLoadEarlier: () => void
  renderedUserMessages: UserMessage[]
  anchor: (id: string) => string
  onRegisterMessage: (el: HTMLDivElement, id: string) => void
  onUnregisterMessage: (id: string) => void
}) {
  let touchGesture: number | undefined

  const params = useParams()
  const sync = useSync()
  const settings = useSettings()
  const language = useLanguage()

  const trigger = (target: EventTarget | null) => {
    const next =
      target instanceof Element
        ? target.closest('[data-slot="collapsible-trigger"], [data-slot="accordion-trigger"], [data-scroll-preserve]')
        : undefined
    if (!(next instanceof HTMLElement)) return
    return next
  }

  const sessionKey = createMemo(() => `${params.dir}${params.id ? "/" + params.id : ""}`)
  const sessionID = createMemo(() => params.id)
  const sessionMessages = createMemo(() => {
    const id = sessionID()
    if (!id) return emptyMessages
    return sync.data.message[id] ?? emptyMessages
  })
  const pending = createMemo(() =>
    sessionMessages().findLast(
      (item): item is AssistantMessage => item.role === "assistant" && typeof item.time.completed !== "number",
    ),
  )
  const sessionStatus = createMemo(() => sync.data.session_status[sessionID() ?? ""]?.type ?? "idle")
  const activeMessageID = createMemo(() => {
    const messages = sessionMessages()
    const message = pending()
    if (message?.parentID) {
      const result = Binary.search(messages, message.parentID, (item) => item.id)
      const parent = result.found ? messages[result.index] : messages.find((item) => item.id === message.parentID)
      if (parent?.role === "user") return parent.id
    }

    if (sessionStatus() === "idle") return undefined
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") return messages[i].id
    }
    return undefined
  })
  const info = createMemo(() => {
    const id = sessionID()
    if (!id) return
    return sync.session.get(id)
  })
  const titleValue = createMemo(() => {
    const title = info()?.title
    if (!title) return
    if (isDefaultSessionTitle(title)) return language.t("command.session.new")
    return title
  })
  const defaultTitle = createMemo(() => isDefaultSessionTitle(info()?.title))
  const headerTitle = createMemo(
    () => titleValue() ?? (props.renderedUserMessages.length ? language.t("command.session.new") : undefined),
  )
  const placeholderTitle = createMemo(() => defaultTitle() || (!info()?.title && props.renderedUserMessages.length > 0))
  const parentID = createMemo(() => info()?.parentID)
  const showHeader = createMemo(() => !!(headerTitle() || parentID()))
  const stageCfg = { init: 1, batch: 3 }
  const staging = createTimelineStaging({
    sessionKey,
    turnStart: () => props.turnStart,
    messages: () => props.renderedUserMessages,
    config: stageCfg,
  })
  const rendered = createMemo(() => staging.messages().map((message) => message.id))

  return (
    <Show
      when={!props.mobileChanges}
      fallback={<div class="relative h-full overflow-hidden">{props.mobileFallback}</div>}
    >
      <div class="relative w-full h-full min-w-0">
        <div
          class="absolute left-1/2 -translate-x-1/2 bottom-6 z-[60] pointer-events-none transition-all duration-200 ease-out"
          classList={{
            "opacity-100 translate-y-0 scale-100":
              props.scroll.overflow && !props.scroll.bottom && !staging.isStaging(),
            "opacity-0 translate-y-2 scale-95 pointer-events-none":
              !props.scroll.overflow || props.scroll.bottom || staging.isStaging(),
          }}
        >
          <button
            class="pointer-events-auto size-8 flex items-center justify-center rounded-full bg-background-base border border-border-base shadow-sm text-text-base hover:bg-background-stronger transition-colors"
            onClick={props.onResumeScroll}
          >
            <Icon name="arrow-down-to-line" />
          </button>
        </div>
        <SessionTimelineHeader
          centered={props.centered}
          showHeader={showHeader}
          sessionKey={sessionKey}
          sessionID={sessionID}
          parentID={parentID}
          titleValue={titleValue}
          headerTitle={headerTitle}
          placeholderTitle={placeholderTitle}
        />
        <ScrollView
          reverse
          viewportRef={props.setScrollRef}
          onWheel={(e) => {
            const root = e.currentTarget
            const delta = normalizeWheelDelta({
              deltaY: e.deltaY,
              deltaMode: e.deltaMode,
              rootHeight: root.clientHeight,
            })
            if (!delta) return
            markBoundaryGesture({ root, target: e.target, delta, onMarkScrollGesture: props.onMarkScrollGesture })
          }}
          onTouchStart={(e) => {
            touchGesture = e.touches[0]?.clientY
          }}
          onTouchMove={(e) => {
            const next = e.touches[0]?.clientY
            const prev = touchGesture
            touchGesture = next
            if (next === undefined || prev === undefined) return

            const delta = prev - next
            if (!delta) return

            const root = e.currentTarget
            markBoundaryGesture({ root, target: e.target, delta, onMarkScrollGesture: props.onMarkScrollGesture })
          }}
          onTouchEnd={() => {
            touchGesture = undefined
          }}
          onTouchCancel={() => {
            touchGesture = undefined
          }}
          onPointerDown={(e) => {
            const next = trigger(e.target)
            if (next) props.onPreserveScrollAnchor(next)

            if (e.target !== e.currentTarget) return
            props.onMarkScrollGesture(e.currentTarget)
          }}
          onKeyDown={(e) => {
            if (e.key !== "Enter" && e.key !== " ") return
            const next = trigger(e.target)
            if (!next) return
            props.onPreserveScrollAnchor(next)
          }}
          onScroll={(e) => {
            props.onScheduleScrollState(e.currentTarget)
            props.onTurnBackfillScroll()
            if (!props.hasScrollGesture()) return
            props.onAutoScrollHandleScroll()
            props.onMarkScrollGesture(e.currentTarget)
            if (props.isDesktop) props.onScrollSpyScroll()
          }}
          onClick={(e) => {
            props.onAutoScrollInteraction(e)
          }}
          class="relative min-w-0 w-full h-full"
          style={{
            "--session-title-height": showHeader() ? "72px" : "0px",
            "--sticky-accordion-top": showHeader() ? "48px" : "0px",
          }}
        >
          <div>
            <div
              ref={props.setContentRef}
              role="log"
              class="flex flex-col gap-0 items-start justify-start pb-16 transition-[margin]"
              style={{ "padding-top": "var(--session-title-height)" }}
              classList={{
                "w-full": true,
                "md:max-w-[500px] md:mx-auto 2xl:max-w-[700px]": props.centered,
                "mt-0.5": props.centered,
                "mt-0": !props.centered,
              }}
            >
              <Show when={props.turnStart > 0 || props.historyMore}>
                <div class="w-full flex justify-center">
                  <Button
                    variant="ghost"
                    size="large"
                    class="text-12-medium opacity-50"
                    disabled={props.historyLoading}
                    onClick={props.onLoadEarlier}
                  >
                    {props.historyLoading
                      ? language.t("session.messages.loadingEarlier")
                      : language.t("session.messages.loadEarlier")}
                  </Button>
                </div>
              </Show>
              <For each={rendered()}>
                {(messageID) => {
                  // Capture at creation time: animate only messages added after the
                  // timeline finishes its initial backfill staging, plus the first
                  // turn while a brand new session is still using its default title.
                  const isNew =
                    staging.ready() ||
                    (defaultTitle() &&
                      sessionStatus() !== "idle" &&
                      props.renderedUserMessages.length === 1 &&
                      messageID === props.renderedUserMessages[0]?.id)
                  const active = createMemo(() => activeMessageID() === messageID)
                  const queued = createMemo(() => {
                    if (active()) return false
                    const activeID = activeMessageID()
                    if (activeID) return messageID > activeID
                    return false
                  })
                  const comments = createMemo(() => messageComments(sync.data.part[messageID] ?? []), [], {
                    equals: (a, b) => {
                      if (a.length !== b.length) return false
                      return a.every((x, i) => x.path === b[i].path && x.comment === b[i].comment)
                    },
                  })
                  const commentCount = createMemo(() => comments().length)
                  return (
                    <div
                      id={props.anchor(messageID)}
                      data-message-id={messageID}
                      ref={(el) => {
                        props.onRegisterMessage(el, messageID)
                        onCleanup(() => props.onUnregisterMessage(messageID))
                      }}
                      classList={{
                        "min-w-0 w-full max-w-full": true,
                        "md:max-w-[500px] 2xl:max-w-[700px]": props.centered,
                      }}
                    >
                      <Show when={commentCount() > 0}>
                        <div class="w-full px-4 md:px-5 pb-2">
                          <div class="ml-auto max-w-[82%] overflow-x-auto no-scrollbar">
                            <div class="flex w-max min-w-full justify-end gap-2">
                              <Index each={comments()}>
                                {(commentAccessor: () => MessageComment) => {
                                  const comment = createMemo(() => commentAccessor())
                                  return (
                                    <div class="shrink-0 max-w-[260px] rounded-[6px] border border-border-weak-base bg-background-stronger px-2.5 py-2">
                                      <div class="flex items-center gap-1.5 min-w-0 text-11-medium text-text-strong">
                                        <FileIcon
                                          node={{ path: comment().path, type: "file" }}
                                          class="size-3.5 shrink-0"
                                        />
                                        <span class="truncate">{getFilename(comment().path)}</span>
                                        <Show when={comment().selection}>
                                          {(selection) => (
                                            <span class="shrink-0 text-text-weak">
                                              {selection().startLine === selection().endLine
                                                ? `:${selection().startLine}`
                                                : `:${selection().startLine}-${selection().endLine}`}
                                            </span>
                                          )}
                                        </Show>
                                      </div>
                                      <div class="pt-1 text-12-regular text-text-strong whitespace-pre-wrap break-words">
                                        {comment().comment}
                                      </div>
                                    </div>
                                  )
                                }}
                              </Index>
                            </div>
                          </div>
                        </div>
                      </Show>
                      <SessionTurn
                        sessionID={sessionID() ?? ""}
                        messageID={messageID}
                        active={active()}
                        queued={queued()}
                        animate={isNew || active()}
                        showReasoningSummaries={settings.general.showReasoningSummaries()}
                        shellToolDefaultOpen={settings.general.shellToolPartsExpanded()}
                        editToolDefaultOpen={settings.general.editToolPartsExpanded()}
                        classes={{
                          root: "min-w-0 w-full relative",
                          content: "flex flex-col justify-between !overflow-visible",
                          container: "w-full px-4 md:px-5",
                        }}
                      />
                    </div>
                  )
                }}
              </For>
            </div>
          </div>
        </ScrollView>
      </div>
    </Show>
  )
}
