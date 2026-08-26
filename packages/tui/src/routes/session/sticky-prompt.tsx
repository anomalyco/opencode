import { createMemo, createSignal, onCleanup, Show } from "solid-js"
import { type BoxRenderable, type ScrollBoxRenderable } from "@opentui/core"
import { useLocal } from "../../context/local"
import { useRouteData } from "../../context/route"
import { useSync } from "../../context/sync"
import { useTheme } from "../../context/theme"
import { useRenderer } from "@opentui/solid"
import { SplitBorder } from "../../ui/border"
import { useDialog } from "../../ui/dialog"
import { Locale } from "../../util/locale"

const STICKY_PROMPT_PADDING_TOP = 1
const STICKY_PROMPT_PADDING_BOTTOM = 1
const STICKY_PROMPT_PADDING_LEFT = 2
const STICKY_PROMPT_PADDING_RIGHT = 1
const STICKY_PROMPT_TEXT_SAFETY_WIDTH = 2
const STICKY_PROMPT_TEXT_LINES = 1
const STICKY_PROMPT_TIMESTAMP_LINES = 1

export function StickyPrompt(props: {
  scroll: () => ScrollBoxRenderable | undefined
  showTimestamps: () => boolean
  scrollbarPadding: () => number
  container: () => BoxRenderable | undefined
}) {
  const route = useRouteData("session")
  const sync = useSync()
  const local = useLocal()
  const { theme } = useTheme()
  const dialog = useDialog()
  const renderer = useRenderer()
  const messages = createMemo(() => sync.data.message[route.sessionID] ?? [])
  const stickyUserMessages = createMemo(() =>
    messages().filter((message) => hasEligibleUserText(message, sync.data.part[message.id] ?? [])),
  )
  const [stickyAnchor, setStickyAnchor] = createSignal<
    { id: string; text: string; agent: string; created: number } | undefined
  >(undefined, {
    equals: (previous, next) =>
      previous?.id === next?.id && previous?.text === next?.text && previous?.agent === next?.agent,
  })
  const [stickyGeometry, setStickyGeometry] = createSignal<{ left: number; width: number } | undefined>(undefined)
  const [stickyHeight, setStickyHeight] = createSignal<number>()
  let attachedScroll: ScrollBoxRenderable | undefined

  const updateStickyAnchor = () => {
    const scroll = props.scroll()
    if (scroll !== attachedScroll) {
      if (attachedScroll) attachedScroll.onMouseScroll = undefined
      attachedScroll = scroll
      if (scroll) scroll.onMouseScroll = () => queueMicrotask(updateStickyAnchor)
    }
    if (!scroll || scroll.isDestroyed) {
      setStickyAnchor(undefined)
      setStickyGeometry(undefined)
      return
    }

    const eligibleMessages = stickyUserMessages()
    const target = findStickyUserMessage(
      scroll.getChildren(),
      new Set(eligibleMessages.map((message) => message.id)),
      scroll.y,
      getStickyPromptHeight(stickyHeight(), props.showTimestamps()),
    )
    if (!target || target.height <= 0) {
      setStickyAnchor(undefined)
      setStickyGeometry(undefined)
      return
    }

    const container = props.container()
    if (!container) {
      setStickyAnchor(undefined)
      setStickyGeometry(undefined)
      return
    }

    const message = eligibleMessages.find((item) => item.id === target.id)
    if (!message) {
      setStickyAnchor(undefined)
      setStickyGeometry(undefined)
      return
    }

    const text = getStickyUserMessageText(sync.data.part[message.id] ?? [])
    setStickyGeometry(getStickyPromptGeometry(container, target, props.scrollbarPadding()))
    setStickyAnchor(text ? { id: message.id, text, agent: message.agent, created: message.time.created } : undefined)
  }

  renderer.on("frame", updateStickyAnchor)
  onCleanup(() => {
    if (attachedScroll) attachedScroll.onMouseScroll = undefined
    renderer.off("frame", updateStickyAnchor)
  })

  return (
    <Show when={stickyAnchor()}>
      {(anchor) => {
        const [hover, setHover] = createSignal(false)
        const [promptContentWidth, setPromptContentWidth] = createSignal(0)
        let promptContent: BoxRenderable | undefined

        return (
          <box
            position="absolute"
            top={0}
            left={stickyGeometry()?.left ?? 0}
            width={stickyGeometry()?.width ?? 0}
            zIndex={1}
            border={["left"]}
            borderColor={local.agent.color(anchor().agent)}
            customBorderChars={SplitBorder.customBorderChars}
          >
            <box
              ref={(box) => {
                promptContent = box
                setPromptContentWidth(box.width)
                setStickyHeight(box.height)
              }}
              paddingTop={STICKY_PROMPT_PADDING_TOP}
              paddingBottom={STICKY_PROMPT_PADDING_BOTTOM}
              paddingLeft={STICKY_PROMPT_PADDING_LEFT}
              paddingRight={STICKY_PROMPT_PADDING_RIGHT}
              width="100%"
              flexShrink={0}
              onSizeChange={() => {
                if (promptContent) {
                  setPromptContentWidth(promptContent.width)
                  setStickyHeight(promptContent.height)
                }
              }}
              backgroundColor={hover() ? theme.backgroundElement : theme.backgroundPanel}
              onMouseOver={() => setHover(true)}
              onMouseOut={() => setHover(false)}
              onMouseUp={() => {
                const scroll = props.scroll()
                const child = scroll?.getChildren().find((child) => child.id === anchor().id)
                if (scroll && child) scroll.scrollBy(getStickyPromptScrollDelta(child.y, scroll.y))
                dialog.clear()
              }}
            >
              <text fg={theme.text} width="100%" overflow="hidden" wrapMode="none">
                {promptContentWidth() > 0
                  ? truncateStickyPrompt(
                      anchor().text,
                      getStickyPromptTextWidth(
                        promptContentWidth(),
                        STICKY_PROMPT_PADDING_LEFT,
                        STICKY_PROMPT_PADDING_RIGHT,
                        STICKY_PROMPT_TEXT_SAFETY_WIDTH,
                      ),
                    )
                  : anchor().text}
              </text>
              <Show when={props.showTimestamps()}>
                <text fg={theme.textMuted}>{Locale.todayTimeOrDateTime(anchor().created)}</text>
              </Show>
            </box>
          </box>
        )
      }}
    </Show>
  )
}

export function getStickyPromptTextWidth(
  contentWidth: number,
  paddingLeft: number,
  paddingRight: number,
  safetyWidth = 0,
) {
  return Math.max(1, contentWidth - paddingLeft - paddingRight - safetyWidth)
}

export function getStickyPromptHeight(measuredHeight: number | undefined, showTimestamps: boolean) {
  if (measuredHeight !== undefined && measuredHeight > 0) return measuredHeight
  return (
    STICKY_PROMPT_PADDING_TOP +
    STICKY_PROMPT_PADDING_BOTTOM +
    STICKY_PROMPT_TEXT_LINES +
    (showTimestamps ? STICKY_PROMPT_TIMESTAMP_LINES : 0)
  )
}

export function getStickyPromptGeometry(
  container: { screenX: number },
  message: { screenX: number; width: number },
  rightPadding = 0,
) {
  return { left: message.screenX - container.screenX, width: message.width + rightPadding }
}

export function getStickyPromptScrollDelta(childY: number, scrollY: number) {
  return childY - scrollY
}

export function truncateStickyPrompt(text: string, maxWidth: number) {
  const ellipsis = "…"
  if (Bun.stringWidth(text) <= maxWidth) return text

  const availableWidth = maxWidth - Bun.stringWidth(ellipsis)
  let prefix = ""
  for (const character of Array.from(text)) {
    const next = prefix + character
    if (Bun.stringWidth(next) > availableWidth) break
    prefix = next
  }
  return prefix + ellipsis
}

type UserTextPart = { type: string; text?: string; synthetic?: boolean; ignored?: boolean }

export function findStickyUserMessage<T extends { id?: string; y: number; height: number; screenX: number; width: number }>(
  children: readonly T[],
  userIDs: ReadonlySet<string>,
  viewportTop: number,
  stickyHeight: number,
) {
  const stickyBottom = viewportTop + stickyHeight
  const overlapBottom = stickyBottom + 1
  const result = children.reduce<{ candidate: T | undefined; blocked: boolean }>(
    (state, child) => {
      if (state.blocked || !child.id || !userIDs.has(child.id)) return state
      if (child.y > overlapBottom) return { ...state, blocked: true }
      if (child.y + child.height > stickyBottom) return { candidate: undefined, blocked: true }
      return { candidate: child, blocked: false }
    },
    { candidate: undefined, blocked: false },
  )
  return result.candidate
}

export function hasEligibleUserText(
  message: { role: string },
  parts: readonly UserTextPart[],
) {
  if (message.role !== "user") return false
  return parts.some(isVisibleTextPart)
}

export function getStickyUserMessageText(parts: readonly UserTextPart[]) {
  return parts
    .flatMap((part) => (isVisibleTextPart(part) ? [part.text ?? ""] : []))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
}

function isVisibleTextPart(part: UserTextPart) {
  return part.type === "text" && !part.synthetic && !part.ignored
}
