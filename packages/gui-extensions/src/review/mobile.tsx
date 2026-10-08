import { onCleanup, Show } from "solid-js"
import { makeEventListener } from "@solid-primitives/event-listener"
import { SessionReview } from "@opencode/session-ui/session-review"
import { createKeyed, useExtension, type MountedSession } from "../sdk"
import type Review from "./index"
import type { ReviewModel } from "./model"
import { ReviewEmpty, ReviewTitle } from "./parts"

type ScrollState = {
  scroll?: HTMLDivElement
  restoreFrame?: number
  userInteracted: boolean
  restored?: { x: number; y: number }
}

/** The narrow-screen review: every changed file as one scrollable list. */
export default function SessionMobileReview(props: { review: ReviewModel; session: MountedSession }) {
  const ctx = useExtension<typeof Review>()
  const links = ctx.links
  const mobileDiff = ctx.stores.mobileDiff

  return (
    <div class="relative h-full overflow-hidden">
      <Show when={!props.review.deferRender()}>
        <SessionReviewTab
          review={props.review}
          session={props.session}
          overflow={mobileDiff.value.wrap ? "wrap" : "scroll"}
          onViewFile={(file) => void links.open({ href: file, exact: true, session: props.session })}
        />
      </Show>
    </div>
  )
}

function SessionReviewTab(props: {
  review: ReviewModel
  session: MountedSession
  overflow: "wrap" | "scroll"
  onViewFile: (file: string) => void
}) {
  const ctx = useExtension()
  const layout = ctx.layout
  const review = props.review
  const state: ScrollState = { userInteracted: false }

  const readFile = async (path: string) => {
    return props.session.server.client.file
      .read({ path, location: { directory: props.review.screen.file.root } })
      .then((data) => ({ type: "text" as const, content: new TextDecoder().decode(data) }))
      .catch((error) => {
        console.debug("[session-review] failed to read file", { path, error })

        return undefined
      })
  }

  const handleInteraction = () => {
    state.userInteracted = true

    if (state.restoreFrame !== undefined) {
      cancelAnimationFrame(state.restoreFrame)
      state.restoreFrame = undefined
    }
  }

  const doRestore = () => {
    state.restoreFrame = undefined
    const el = state.scroll

    if (!el || !layout.ready() || state.userInteracted) return

    if (el.clientHeight === 0 || el.clientWidth === 0) return

    const s = layout.scroll.get(props.session, "review")

    if (!s || (s.x === 0 && s.y === 0)) return

    const maxY = Math.max(0, el.scrollHeight - el.clientHeight)
    const maxX = Math.max(0, el.scrollWidth - el.clientWidth)

    const targetY = Math.min(s.y, maxY)
    const targetX = Math.min(s.x, maxX)

    if (el.scrollTop === targetY && el.scrollLeft === targetX) return

    if (el.scrollTop !== targetY) el.scrollTop = targetY

    if (el.scrollLeft !== targetX) el.scrollLeft = targetX
    state.restored = { x: el.scrollLeft, y: el.scrollTop }
  }

  const queueRestore = () => {
    if (state.userInteracted || state.restoreFrame !== undefined) return
    state.restoreFrame = requestAnimationFrame(doRestore)
  }

  const handleScroll = (event: Event & { currentTarget: HTMLDivElement }) => {
    const el = event.currentTarget
    const prev = state.restored

    if (prev && el.scrollTop === prev.y && el.scrollLeft === prev.x) {
      state.restored = undefined

      return
    }

    state.restored = undefined
    handleInteraction()

    if (!layout.ready()) return

    if (el.clientHeight === 0 || el.clientWidth === 0) return

    layout.scroll.set(props.session, "review", {
      x: el.scrollLeft,
      y: el.scrollTop,
    })
  }

  // Restores the stored scroll once the layout loads, and again when the list or its wrapping changes.
  createKeyed(
    () => {
      const count = review.diffs().length
      const overflow = props.overflow

      return layout.ready() ? { count, overflow } : undefined
    },
    () => queueRestore(),
  )

  onCleanup(() => {
    if (state.restoreFrame !== undefined) cancelAnimationFrame(state.restoreFrame)
    review.setScroll(undefined)
  })

  return (
    <SessionReview
      title={<ReviewTitle review={review} />}
      empty={<ReviewEmpty review={review} loadingClass="px-2 py-2 text-text-weak" />}
      scrollRef={(el) => {
        state.scroll = el
        makeEventListener(el, "wheel", handleInteraction, { passive: true, capture: true })
        makeEventListener(el, "mousewheel", handleInteraction, { passive: true, capture: true })
        makeEventListener(el, "pointerdown", handleInteraction, { passive: true, capture: true })
        makeEventListener(el, "touchstart", handleInteraction, { passive: true, capture: true })
        makeEventListener(el, "keydown", handleInteraction, { capture: true })
        review.setScroll(el)
        queueRestore()
      }}
      onScroll={handleScroll}
      onDiffRendered={queueRestore}
      open={review.open()}
      onOpenChange={review.setOpen}
      classes={{
        root: "[&_[data-slot=session-review-list]]:pb-0 [&_[data-slot=accordion-trigger]]:!rounded-none [&_[data-slot=accordion-trigger]]:!border-x-0 [&_[data-slot=accordion-item]:first-child_[data-slot=accordion-trigger]]:!border-t-0 [&_[data-slot=accordion-item]:last-child:not([data-expanded])_[data-slot=accordion-trigger]]:!border-b-0 [&_[data-slot=accordion-item]:last-child_[data-slot=accordion-content]]:!border-b-0 [&_[data-slot=accordion-item]:last-child_[data-slot=session-review-diff-placeholder]]:!border-b-0 [&_[data-slot=accordion-content]]:!rounded-none [&_[data-slot=accordion-content]]:!border-x-0 [&_[data-slot=session-review-diff-placeholder]]:!rounded-none [&_[data-slot=session-review-diff-placeholder]]:!border-x-0",
        header:
          "!px-2 !h-10 !pb-0 relative before:pointer-events-none before:absolute before:inset-x-0 before:bottom-0 before:h-px before:bg-v2-border-border-base before:content-['']",
        container: "!px-0",
      }}
      diffs={review.diffs()}
      diffStyle="unified"
      changeSummary
      overflow={props.overflow}
      disableLineNumbers={false}
      onViewFile={props.onViewFile}
      focusedFile={review.activeFile()}
      readFile={readFile}
      onLineComment={review.comments.add}
      onLineCommentUpdate={review.comments.update}
      onLineCommentDelete={review.comments.remove}
      lineCommentActions={review.comments.actions()}
      lineCommentMention={{ items: review.comments.mentions }}
      comments={review.comments.all()}
      focusedComment={review.comments.focus()}
      onFocusedCommentChange={review.comments.setFocus}
    />
  )
}
