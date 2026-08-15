import { createEffect, createMemo, createSignal, Show } from "solid-js"
import type { Accessor } from "solid-js"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { Dialog } from "@opencode-ai/ui/dialog"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Markdown } from "@opencode-ai/session-ui/markdown"
import { TextReveal } from "@opencode-ai/ui/text-reveal"
import { TextShimmer } from "@opencode-ai/ui/text-shimmer"
import type { AssistantMessage, Part, ReasoningPart } from "@opencode-ai/sdk/v2"
import { useLanguage } from "@/context/language"
import { useSessionLayout } from "@/pages/session/session-layout"
import { useSettings } from "@/context/settings"
import { useSync } from "@/context/sync"

const emptyMessages: AssistantMessage[] = []
const emptyParts: Part[] = []

const readPartText = (accum: Record<string, string> | undefined, part: ReasoningPart) =>
  (accum?.[part.id] ?? part.text ?? "").trim()

export function useThinkingStream(
  sessionID: Accessor<string | undefined>,
  userMessageID: Accessor<string | undefined>,
) {
  const sync = useSync()

  const assistantMessages = createMemo(() => {
    const session = sessionID()
    const user = userMessageID()
    if (!session || !user) return emptyMessages
    return (sync().data.message[session] ?? []).filter(
      (message): message is AssistantMessage => message.role === "assistant" && message.parentID === user,
    )
  })

  const reasoningParts = createMemo(() =>
    assistantMessages().flatMap((message) =>
      (sync().data.part[message.id] ?? emptyParts).filter((part): part is ReasoningPart => part.type === "reasoning"),
    ),
  )

  const streaming = createMemo(() => {
    const last = assistantMessages().at(-1)
    return !!last && typeof last.time?.completed !== "number"
  })

  const text = createMemo(() => {
    const accum = sync().data.part_text_accum_delta
    return reasoningParts()
      .map((part) => readPartText(accum, part))
      .filter((value) => !!value)
      .join("\n\n")
  })

  return { assistantMessages, reasoningParts, streaming, text }
}

export function useSessionThinkingTarget(sessionID: Accessor<string | undefined>) {
  const sync = useSync()

  const target = createMemo(() => {
    const session = sessionID()
    if (!session) return undefined
    const messages = sync().data.message[session] ?? []
    const accum = sync().data.part_text_accum_delta
    let fallback: string | undefined
    let streamingTarget: string | undefined
    for (const message of messages) {
      if (message.role !== "assistant" || !message.parentID) continue
      const parts = sync().data.part[message.id] ?? emptyParts
      const hasReasoning = parts.some((part) => part.type === "reasoning" && readPartText(accum, part))
      if (!hasReasoning) continue
      fallback = message.parentID
      if (typeof message.time?.completed !== "number") streamingTarget = message.parentID
    }
    const userMessageID = streamingTarget ?? fallback
    if (!userMessageID) return undefined
    return { userMessageID, streaming: streamingTarget === userMessageID }
  })

  const stream = useThinkingStream(sessionID, () => target()?.userMessageID)
  return { ...stream, target }
}

function ThinkingTitle() {
  const language = useLanguage()
  return (
    <span class="flex items-center gap-2">
      <Icon name="brain" size="small" />
      <span>{language.t("thinkingViewer.title")}</span>
    </span>
  )
}

export function ThinkingStream(props: {
  text: Accessor<string>
  streaming: Accessor<boolean>
  class?: string
}) {
  const language = useLanguage()
  const [scroller, setScroller] = createSignal<HTMLDivElement>()
  const follow = { current: true }

  createEffect(() => {
    const text = props.text()
    if (!text) {
      follow.current = true
      return
    }
    if (!follow.current) return
    const node = scroller()
    if (!node) return
    requestAnimationFrame(() => {
      node.scrollTop = node.scrollHeight
    })
  })

  const markScroll = (event: Event & { currentTarget: HTMLDivElement }) => {
    const node = event.currentTarget
    follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 32
  }

  return (
    <div
      ref={setScroller}
      onScroll={markScroll}
      class={`min-h-0 flex-1 overflow-y-auto px-3 py-2 ${props.class ?? ""}`}
    >
      <Show
        when={props.text()}
        fallback={
          <div class="flex h-full items-center justify-center">
            <div class="text-12-regular text-text-weak">{language.t("thinkingViewer.empty")}</div>
          </div>
        }
      >
        <Markdown text={props.text()} streaming={props.streaming()} class="text-13-regular text-text-weaker" />
      </Show>
    </div>
  )
}

export function ThinkingViewerFullscreen(props: {
  sessionID: Accessor<string | undefined>
  userMessageID: Accessor<string | undefined>
}) {
  const stream = useThinkingStream(props.sessionID, props.userMessageID)
  return (
    <Dialog size="x-large" transition title={<ThinkingTitle />}>
      <ThinkingStream text={stream.text} streaming={stream.streaming} />
    </Dialog>
  )
}

export function ThinkingViewer(props: {
  userMessageID: string
  reasoningHeading?: string
  showReasoningSummaries: boolean
}) {
  const layout = useSessionLayout()
  const settings = useSettings()
  const language = useLanguage()
  const dialog = useDialog()
  const sessionID = createMemo(() => layout.params.id)
  const stream = useThinkingStream(sessionID, () => props.userMessageID)
  const [expanded, setExpanded] = createSignal(false)

  createEffect(() => {
    if (settings.general.thinkingViewerInline()) setExpanded(true)
  })

  const expand = () => setExpanded(true)
  const collapse = () => setExpanded(false)
  const dock = () => {
    if (!layout.view().reviewPanel.opened()) layout.view().reviewPanel.open()
    void layout.tabs().open("thinking")
  }
  const openFullscreen = () => {
    void dialog.show(() => <ThinkingViewerFullscreen sessionID={sessionID} userMessageID={() => props.userMessageID} />)
  }

  return (
    <Show
      when={expanded()}
      fallback={
        <button
          type="button"
          data-slot="session-turn-thinking"
          class="w-full flex items-center gap-2 rounded-md px-1 py-0.5 text-left hover:bg-background-stronger"
          onClick={expand}
          aria-label={language.t("thinkingViewer.expand")}
        >
          <TextShimmer text={language.t("ui.sessionTurn.status.thinking")} />
          <Show when={!props.showReasoningSummaries}>
            <TextReveal
              text={props.reasoningHeading}
              class="session-turn-thinking-heading"
              travel={25}
              duration={700}
            />
          </Show>
        </button>
      }
    >
      <div
        data-slot="session-turn-thinking"
        data-expanded="true"
        class="w-full overflow-hidden rounded-md border border-border-weaker-base bg-background-stronger"
      >
        <div class="flex items-center gap-2 px-2 py-1">
          <Icon name="brain" size="small" class="text-text-weak" />
          <div class="text-12-medium text-text-weak">{language.t("thinkingViewer.title")}</div>
          <div class="ml-auto flex items-center gap-0.5">
            <Tooltip value={language.t("thinkingViewer.actions.fullscreen")} placement="top">
              <IconButton
                icon="window-cursor"
                variant="ghost"
                class="h-5 w-5"
                onClick={openFullscreen}
                aria-label={language.t("thinkingViewer.actions.fullscreen")}
              />
            </Tooltip>
            <Tooltip value={language.t("thinkingViewer.actions.dock")} placement="top">
              <IconButton
                icon="layout-right"
                variant="ghost"
                class="h-5 w-5"
                onClick={dock}
                aria-label={language.t("thinkingViewer.actions.dock")}
              />
            </Tooltip>
            <Tooltip value={language.t("thinkingViewer.actions.collapse")} placement="top">
              <IconButton
                icon="chevron-down"
                variant="ghost"
                class="h-5 w-5"
                onClick={collapse}
                aria-label={language.t("thinkingViewer.actions.collapse")}
              />
            </Tooltip>
          </div>
        </div>
        <div class="h-40 flex flex-col border-t border-border-weaker-base">
          <ThinkingStream text={stream.text} streaming={stream.streaming} />
        </div>
      </div>
    </Show>
  )
}
