import { createMemo, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Portal } from "solid-js/web"
import { makeEventListener } from "@solid-primitives/event-listener"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { LineCommentEditor } from "@opencode/ui/line-comment"
import { useLanguage } from "@/runtime/i18n/language"
import type { ComposerQuoteAnchor } from "@opencode/plugin/gui"
import type { ComposerDelivery } from "../adapter"

const IS_MAC = /(Mac|iPod|iPhone|iPad)/.test(navigator.platform)

const sendLabels = {
  queue: "session.quote.queue",
  steer: "session.quote.steer",
  send: "session.quote.send",
} as const

const GAP = 8

const WIDTH = 320

export function QuoteCommentEditor(props: {
  anchor: HTMLElement
  source?: ComposerQuoteAnchor
  text: string
  comment: string
  mention: (query: string) => Promise<string[]>
  onSubmit: (comment: string) => void
  onClose: (focus?: boolean) => void
  send?: {
    available: boolean
    delivery: ComposerDelivery | undefined
    onSubmit: (comment: string) => Promise<boolean>
  }
}) {
  const language = useLanguage()

  const [state, setState] = createStore({
    draft: props.comment,
    rect: bounds(props.anchor),
    viewport: window.innerWidth,
    viewportHeight: window.innerHeight,
    revision: 0,
    height: 0,
    openingHeight: 0,
    sending: false,
    failed: false,
  })

  const width = () => Math.min(WIDTH, state.viewport - GAP * 2)

  const source = createMemo(() => {
    // DOM scroll is not reactive; scheduled measurements invalidate the source's viewport coordinates.
    void state.revision

    if (!state.openingHeight) return

    return props.source?.({ width: width(), height: state.openingHeight })
  })

  let element: HTMLElement | undefined

  let frame: number | undefined

  let mounted = true

  const schedule = () => {
    if (frame !== undefined) return
    frame = requestAnimationFrame(() => {
      frame = undefined
      setState({
        rect: bounds(props.anchor),
        viewport: window.innerWidth,
        viewportHeight: window.innerHeight,
        revision: state.revision + 1,
      })
    })
  }

  onCleanup(() => {
    mounted = false

    if (frame !== undefined) cancelAnimationFrame(frame)
  })

  makeEventListener(window, "resize", schedule)
  makeEventListener(document, "scroll", schedule, { capture: true, passive: true })
  createResizeObserver(() => props.anchor.parentElement, schedule)
  makeEventListener(document, "pointerdown", (event) => {
    const target = event.target

    if (target instanceof Node && (element?.contains(target) || props.anchor.contains(target))) return

    if (!state.sending && state.draft.trim() === props.comment.trim()) props.onClose()
  })

  const left = () => Math.min(Math.max(source()?.left ?? state.rect.left, GAP), state.viewport - width() - GAP)

  const bottom = createMemo(() => {
    // Preserve the opening bottom edge as the draft grows upward.
    const above = state.rect.top - state.openingHeight - GAP
    const desired = source()?.top ?? (above >= GAP ? above : state.rect.bottom + GAP)

    return Math.min(state.viewportHeight - GAP, Math.max(GAP + state.openingHeight, desired + state.openingHeight))
  })

  const availableHeight = () => Math.max(0, bottom() - GAP)
  const top = () => Math.max(GAP, bottom() - state.height)

  const alternateSubmit = createMemo(() => {
    const send = props.send

    if (!send) return

    return {
      label: language.t(sendLabels[send.delivery ?? "send"]),
      keys: [IS_MAC ? "⌘" : language.t("common.key.ctrl"), "⏎"],
      disabled: !send.available,
      onSubmit: async (comment: string) => {
        setState({ sending: true, failed: false })

        const sent = await send.onSubmit(comment)

        if (!mounted) return
        setState({ sending: false, failed: !sent })

        if (sent) props.onClose()
      },
    }
  })

  return (
    <Portal>
      <div
        ref={(value) => {
          element = value
          createResizeObserver(value, () => {
            setState({
              height: value.offsetHeight,
              openingHeight: state.openingHeight || value.offsetHeight,
            })
          })
        }}
        data-component="composer-quote-comment"
        data-prevent-autofocus
        class="fixed z-50"
        style={{
          top: `${top()}px`,
          left: `${left()}px`,
          width: `${width()}px`,
          "max-height": `${availableHeight()}px`,
          "--line-comment-max-height": `${availableHeight()}px`,
          // Transparent rather than hidden while unmeasured, so the comment field can take focus as it mounts.
          opacity: state.height === 0 ? 0 : undefined,
        }}
      >
        <div
          data-scrollable
          class="overflow-y-auto rounded-[8px] shadow-[var(--v2-elevation-floating)]"
          style={{ "max-height": `${availableHeight()}px` }}
        >
          <LineCommentEditor
            variant="compact"
            style={{ "--line-comment-preview-lines": props.source ? 2 : 4 }}
            value={state.draft}
            onInput={(value) => setState("draft", value)}
            onCancel={() => props.onClose(true)}
            onSubmit={props.onSubmit}
            submitting={state.sending}
            alternateSubmit={alternateSubmit()}
            placeholder={language.t("session.quote.optionalCommentPlaceholder")}
            submitLabel={language.t(
              props.comment.trim()
                ? "common.save"
                : state.draft.trim()
                  ? "session.quote.addComment"
                  : "session.quote.done",
            )}
            allowEmpty
            mention={{ items: props.mention }}
            selection={<span dir="auto">{props.text}</span>}
          />
          <Show when={state.failed}>
            <p
              role="alert"
              class="rounded-b-[8px] bg-v2-background-bg-layer-01 px-3 pb-3 text-[12px] leading-[var(--line-height-compact)] text-v2-text-text-base"
            >
              {language.t("session.quote.sendFailed")}
            </p>
          </Show>
        </div>
      </div>
    </Portal>
  )
}

function bounds(element: HTMLElement) {
  const rect = element.getBoundingClientRect()

  return { top: rect.top, bottom: rect.bottom, left: rect.left }
}
