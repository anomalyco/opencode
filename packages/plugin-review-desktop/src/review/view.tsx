import { Show } from "solid-js"
import { Select } from "@opencode/ui/select"
import { SessionReviewEmptyChangesV2 } from "@opencode/session-ui/v2/session-review-empty-changes-v2"
import { ReviewPanel } from "./panel"
import type { SessionReviewModel } from "./model"
import { useLanguage } from "../environment"

export function ReviewContent(props: { review: SessionReviewModel }) {
  const language = useLanguage()
  return (
    <div class="flex flex-col h-full overflow-hidden bg-v2-background-bg-base contain-strict">
      <ReviewPanel
        title={
          <Show when={props.review.options().length}>
            <Select
              options={[...props.review.options()]}
              current={props.review.mode()}
              label={(option) =>
                language.t(option === "git" ? "ui.sessionReview.title.git" : "ui.sessionReview.title.branch")
              }
              onSelect={(value) => value && props.review.setMode(value)}
            />
          </Show>
        }
        empty={
          <Show
            when={props.review.ready()}
            fallback={
              <div role="status" class="px-6 py-4 text-text-weak">
                {language.t("session.review.loadingChanges")}
              </div>
            }
          >
            <SessionReviewEmptyChangesV2 />
          </Show>
        }
        diffs={props.review.diffs()}
        diffsReady={props.review.ready()}
        diffVersion={props.review.diffVersion()}
        loadDiff={props.review.loadDiff}
        activeFile={props.review.activeFile()}
        onSelectFile={props.review.focusFile}
        diffStyle={props.review.diffStyle()}
        onDiffStyleChange={props.review.setDiffStyle}
        state={props.review.panelState}
        onLineComment={props.review.comments.add}
        onLineCommentUpdate={props.review.comments.update}
        onLineCommentDelete={props.review.comments.remove}
        lineCommentActions={props.review.comments.actions()}
        comments={props.review.comments.all()}
        focusedComment={props.review.comments.focus()}
        onFocusedCommentChange={props.review.comments.setFocus}
      />
    </div>
  )
}
