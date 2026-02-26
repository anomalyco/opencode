import { createEffect, on, onCleanup, type JSX } from "solid-js"
import type { FileDiff } from "@opencode-ai/sdk/v2"
import { SessionReview } from "@opencode-ai/ui/session-review"
import type { SelectedLineRange } from "@/context/file"
import { useSDK } from "@/context/sdk"
import { useLayout } from "@/context/layout"
import type { LineComment } from "@/context/comments"

export type DiffStyle = "unified" | "split"

export interface SessionReviewTabProps {
  title?: JSX.Element
  empty?: JSX.Element
  diffs: () => FileDiff[]
  view: () => ReturnType<ReturnType<typeof useLayout>["view"]>
  diffStyle: DiffStyle
  onDiffStyleChange?: (style: DiffStyle) => void
  onViewFile?: (file: string) => void
  onLineComment?: (comment: { file: string; selection: SelectedLineRange; comment: string; preview?: string }) => void
  comments?: LineComment[]
  focusedComment?: { file: string; id: string } | null
  onFocusedCommentChange?: (focus: { file: string; id: string } | null) => void
  focusedFile?: string
  onScrollRef?: (el: HTMLDivElement) => void
  classes?: {
    root?: string
    header?: string
    container?: string
  }
}

export function StickyAddButton(props: { children: JSX.Element }) {
  return (
    <div class="bg-background-stronger h-full shrink-0 sticky right-0 z-10 flex items-center justify-center pr-3">
      {props.children}
    </div>
  )
}

export function SessionReviewTab(props: SessionReviewTabProps) {
  let scroll: HTMLDivElement | undefined
  let frame: number | undefined
  let pending: { x: number; y: number } | undefined

  const sdk = useSDK()

  const readFile = async (path: string) => {
    return sdk.client.file
      .read({ path })
      .then((x) => x.data)
      .catch((error) => {
        console.debug("[session-review] failed to read file", { path, error })
        return undefined
      })
  }

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
      title={props.title}
      empty={props.empty}
      scrollRef={(el) => {
        scroll = el
        props.onScrollRef?.(el)
        restoreScroll()
      }}
      onScroll={handleScroll}
      onDiffRendered={() => requestAnimationFrame(restoreScroll)}
      open={props.view().review.open()}
      onOpenChange={props.view().review.setOpen}
      classes={{
        root: props.classes?.root ?? "pb-6 pr-3",
        header: props.classes?.header ?? "px-3",
        container: props.classes?.container ?? "pl-3",
      }}
      diffs={props.diffs()}
      diffStyle={props.diffStyle}
      onDiffStyleChange={props.onDiffStyleChange}
      onViewFile={props.onViewFile}
      focusedFile={props.focusedFile}
      readFile={readFile}
      onLineComment={props.onLineComment}
      comments={props.comments}
      focusedComment={props.focusedComment}
      onFocusedCommentChange={props.onFocusedCommentChange}
    />
  )
}
