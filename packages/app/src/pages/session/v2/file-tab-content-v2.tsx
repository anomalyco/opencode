import { createMemo, Show } from "solid-js"
import { SessionReviewFilePreviewV2 } from "@opencode-ai/session-ui/v2/session-review-file-preview-v2"
import { useFile } from "@/context/file"
import { useSDK } from "@/context/sdk"
import { FileTabContent } from "@/pages/session/file-tabs"
import { filterRenderableDiff } from "@/pages/session/v2/review-diff-kinds"
import { makeReadFile, type ReviewPanelV2Props } from "@/pages/session/v2/review-panel-v2"

export function FileTabContentV2(props: { tab: string; review: () => ReviewPanelV2Props }) {
  const file = useFile()
  const sdk = useSDK()
  const review = props.review
  const readFile = makeReadFile(sdk)

  const path = createMemo(() => file.pathFromTab(props.tab))
  const diffItem = createMemo(() => {
    const value = path()
    if (!value) return
    return review().diffs().filter(filterRenderableDiff).find((diff) => diff.file === value)
  })

  return (
    <Show when={diffItem()} keyed fallback={<FileTabContent tab={props.tab} embedded />}>
      {(diff) => {
        const model = review()
        return (
          <div data-component="session-review-v2" class="flex flex-col h-full min-h-0 overflow-hidden">
            <SessionReviewFilePreviewV2
              file={diff.file}
              diff={diff}
              diffStyle={model.diffStyle}
              expandMode={model.state.expandMode()}
              readFile={readFile}
              onLineComment={model.onLineComment}
              onLineCommentUpdate={model.onLineCommentUpdate}
              onLineCommentDelete={model.onLineCommentDelete}
              lineCommentActions={model.lineCommentActions}
              comments={model.comments}
              focusedComment={model.focusedComment}
              onFocusedCommentChange={model.onFocusedCommentChange}
            />
          </div>
        )
      }}
    </Show>
  )
}
