import { createEffect, on, onCleanup } from "solid-js"
import { useLayout } from "@/context/layout"
import { SessionReview } from "@opencode-ai/ui/session-review"
import type { FileDiff } from "@opencode-ai/sdk/v2/client"

interface SessionReviewTabProps {
  diffs: () => FileDiff[]
  view: () => ReturnType<ReturnType<typeof useLayout>["view"]>
}

export function SessionReviewTab(props: SessionReviewTabProps) {
  const layout = useLayout()

  let scroll: HTMLDivElement | undefined
  let frame: number | undefined
  let pending: { x: number; y: number } | undefined

  const restoreScroll = () => {
    const el = scroll
    if (!el) return

    const s = props.view().scroll("review")
    if (!s) return

    if (el.scrollTop !== s.y) el.scrollTop = s.y
    if (el.scrollLeft !== s.x) el.scrollLeft = s.x
  }

  const handleScroll = (event: Event & { currentTarget: HTMLDivElement }) => {
    pending = {
      x: event.currentTarget.scrollLeft,
      y: event.currentTarget.scrollTop,
    }
    if (frame !== undefined) return

    frame = requestAnimationFrame(() => {
      frame = undefined

      const next = pending
      pending = undefined
      if (!next) return

      props.view().setScroll("review", next)
    })
  }

  createEffect(
    on(
      () => props.diffs().length,
      () => {
        requestAnimationFrame(restoreScroll)
      },
      { defer: true },
    ),
  )

  onCleanup(() => {
    if (frame === undefined) return
    cancelAnimationFrame(frame)
  })

  return (
    <SessionReview
      scrollRef={(el) => {
        scroll = el
        restoreScroll()
      }}
      onScroll={handleScroll}
      open={props.view().review.open()}
      onOpenChange={props.view().review.setOpen}
      classes={{
        root: "pb-40",
        header: "px-6",
        container: "px-6",
      }}
      diffs={props.diffs()}
      diffStyle={layout.review.diffStyle()}
      onDiffStyleChange={layout.review.setDiffStyle}
    />
  )
}
