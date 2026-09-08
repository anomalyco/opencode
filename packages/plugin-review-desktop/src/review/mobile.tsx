import { createEffect, onCleanup } from "solid-js"
import { SessionReview } from "@opencode/session-ui/session-review"
import { usePlugin } from "@opencode/plugin/desktop"
import { useEnvironment } from "../environment"
import type { SessionReviewModel } from "./model"

export function MobileReview(props: { review: SessionReviewModel }) {
  const ctx = usePlugin()
  const environment = useEnvironment()
  const view = environment.services.view
  const [state, update] = ctx.storage.store(`accordion.${environment.session.key}`, { initial: { open: [] as string[] } })
  let scroll: HTMLDivElement | undefined
  let frame: number | undefined
  let interacted = false
  const restore = () => {
    if (interacted || frame !== undefined) return
    frame = requestAnimationFrame(() => { frame = undefined; const saved = view.scroll("review"); if (scroll && saved) { scroll.scrollTop = saved.y; scroll.scrollLeft = saved.x } })
  }
  createEffect(() => { props.review.diffs(); if (view.ready()) restore() })
  onCleanup(() => { if (frame !== undefined) cancelAnimationFrame(frame) })
  return <SessionReview
    title={ctx.i18n.t(props.review.mode() === "git" ? "ui.sessionReview.title.git" : "ui.sessionReview.title.branch")}
    empty={<div class="p-4 text-text-weak">{ctx.i18n.t(props.review.ready() ? "session.review.noChanges" : "session.review.loadingChanges")}</div>}
    diffs={props.review.diffs()} diffStyle="unified" changeSummary overflow="scroll" disableLineNumbers={false}
    open={state.open} onOpenChange={(value) => update((draft) => { draft.open = value })}
    scrollRef={(element) => { scroll = element; restore() }} onDiffRendered={restore}
    onScroll={(event) => { interacted = true; view.setScroll("review", { x: event.currentTarget.scrollLeft, y: event.currentTarget.scrollTop }) }}
    onViewFile={props.review.openFile}
    readFile={(path) => environment.session.server.client.file.read({ path, location: environment.session.location }).then((data) => ({ type: "text" as const, content: new TextDecoder().decode(data) }))}
    onLineComment={props.review.comments.add} onLineCommentUpdate={props.review.comments.update} onLineCommentDelete={props.review.comments.remove}
    lineCommentActions={props.review.comments.actions()} lineCommentMention={{ items: environment.services.files.searchFilesAndDirectories }} comments={props.review.comments.all()} focusedComment={props.review.comments.focus()} onFocusedCommentChange={props.review.comments.setFocus}
    classes={{ root: "[&_[data-slot=session-review-list]]:pb-0 [&_[data-slot=accordion-trigger]]:!rounded-none [&_[data-slot=accordion-trigger]]:!border-x-0", header: "!px-2 !h-10 !pb-0", container: "!px-0" }}
  />
}
