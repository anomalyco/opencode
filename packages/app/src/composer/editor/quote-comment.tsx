import { createStore } from "solid-js/store"
import { Portal } from "solid-js/web"
import { makeEventListener } from "@solid-primitives/event-listener"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { Icon } from "@opencode/ui/icon"
import { LineCommentEditor } from "@opencode/ui/line-comment"
import { useLanguage } from "@/runtime/i18n/language"

const GAP = 8

const WIDTH = 380

export function QuoteCommentEditor(props: {
  anchor: HTMLElement
  text: string
  icon?: string
  comment: string
  mention: (query: string) => Promise<string[]>
  onSubmit: (comment: string) => void
  onClose: () => void
}) {
  const language = useLanguage()

  const [state, setState] = createStore({
    draft: props.comment,
    rect: bounds(props.anchor),
    viewport: window.innerWidth,
    height: 0,
  })

  let element: HTMLElement | undefined
  const measure = () => setState({ rect: bounds(props.anchor), viewport: window.innerWidth })

  makeEventListener(window, "resize", measure)
  makeEventListener(document, "scroll", measure, { capture: true, passive: true })
  makeEventListener(document, "pointerdown", (event) => {
    const target = event.target

    if (target instanceof Node && (element?.contains(target) || props.anchor.contains(target))) return

    if (state.draft.trim() === props.comment.trim()) props.onClose()
  })

  const width = () => Math.min(WIDTH, state.viewport - GAP * 2)
  const left = () => Math.min(Math.max(state.rect.left, GAP), state.viewport - width() - GAP)

  const top = () => {
    const above = state.rect.top - state.height - GAP

    return above >= GAP ? above : state.rect.bottom + GAP
  }

  return (
    <Portal>
      <div
        ref={(value) => {
          element = value
          createResizeObserver(value, () => setState("height", value.offsetHeight))
        }}
        data-component="composer-quote-comment"
        data-prevent-autofocus
        class="fixed z-50 overflow-y-auto rounded-[6px] shadow-[var(--v2-elevation-raised)]"
        style={{
          top: `${top()}px`,
          left: `${left()}px`,
          width: `${width()}px`,
          // Transparent rather than hidden while unmeasured, so the comment field can take focus as it mounts.
          opacity: state.height === 0 ? 0 : undefined,
        }}
      >
        <LineCommentEditor
          value={state.draft}
          onInput={(value) => setState("draft", value)}
          onCancel={props.onClose}
          onSubmit={props.onSubmit}
          placeholder={language.t("session.quote.commentPlaceholder")}
          allowEmpty
          mention={{ items: props.mention }}
          selection={
            <span class="flex min-w-0 items-center gap-1" dir="auto">
              <Icon name={props.icon ?? "outline-quote"} size="small" class="shrink-0" />
              <span class="min-w-0 truncate leading-[var(--line-height-tight)]">{props.text.slice(0, 200)}</span>
            </span>
          }
        />
      </div>
    </Portal>
  )
}

function bounds(element: HTMLElement) {
  const rect = element.getBoundingClientRect()

  return { top: rect.top, bottom: rect.bottom, left: rect.left }
}
