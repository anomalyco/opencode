import { createMemo, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { Portal } from "solid-js/web"
import { makeEventListener } from "@solid-primitives/event-listener"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { LineCommentEditor } from "@opencode/ui/line-comment"
import { useLanguage } from "@/runtime/i18n/language"
import type { ComposerQuoteAnchor } from "@opencode/plugin/gui"

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
    if (frame !== undefined) cancelAnimationFrame(frame)
  })

  makeEventListener(window, "resize", schedule)
  makeEventListener(document, "scroll", schedule, { capture: true, passive: true })
  createResizeObserver(() => props.anchor.parentElement, schedule)
  makeEventListener(document, "pointerdown", (event) => {
    const target = event.target

    if (target instanceof Node && (element?.contains(target) || props.anchor.contains(target))) return

    if (state.draft.trim() === props.comment.trim()) props.onClose()
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
        </div>
      </div>
    </Portal>
  )
}

function bounds(element: HTMLElement) {
  const rect = element.getBoundingClientRect()

  return { top: rect.top, bottom: rect.bottom, left: rect.left }
}
