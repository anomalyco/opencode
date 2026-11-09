import { onCleanup, Show } from "solid-js"
import { makeEventListener } from "@solid-primitives/event-listener"
import { SessionReview } from "@opencode/session-ui/session-review"
import { createKeyed, usePlugin, type MountedSession } from "@opencode/plugin/gui"
import type Review from "./index"
import type { ReviewModel } from "./model"
import { ReviewEmpty, ReviewTitle } from "./parts"

/** The narrow-screen review: every changed file as one scrollable list. */
export default function SessionMobileReview(props: { review: ReviewModel; session: MountedSession }) {
  const ctx = usePlugin<typeof Review>()
  const links = ctx.links
  const mobileDiff = ctx.stores.mobileDiff

  return (
    <div class="relative h-full overflow-hidden">
      <Show when={props.review.mobileReady()}>
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
  const review = props.review

  // Restores the stored scroll again when the list or its wrapping changes; the machine waits for the layout.
  createKeyed(
    () => ({ count: review.diffs().length, overflow: props.overflow }),
    () => review.requestRestore(),
    { equals: (previous, next) => previous.count === next.count && previous.overflow === next.overflow },
  )

  onCleanup(() => review.setScroll(undefined))

  return (
    <SessionReview
      title={<ReviewTitle review={review} />}
      empty={<ReviewEmpty review={review} loadingClass="px-2 py-2 text-text-weak" />}
      scrollRef={(el) => {
        // Input, not the scroll events a restore, a layout change or a focused file's scrolling fires, hands the
        // list to the user.
        makeEventListener(el, "wheel", review.interacted, { passive: true, capture: true })
        makeEventListener(el, "mousewheel", review.interacted, { passive: true, capture: true })
        makeEventListener(el, "pointerdown", review.interacted, { passive: true, capture: true })
        makeEventListener(el, "touchstart", review.interacted, { passive: true, capture: true })
        makeEventListener(el, "keydown", review.interacted, { capture: true })
        review.setScroll(el)
      }}
      onScroll={(event) => review.saveScroll(props.session, event.currentTarget)}
      onDiffRendered={review.requestRestore}
      open={review.open()}
      onOpenChange={(open) => {
        review.interacted()
        review.setOpen(open)
      }}
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
      readFile={review.readFile}
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
