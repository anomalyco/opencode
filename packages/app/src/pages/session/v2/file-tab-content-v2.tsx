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
    return review()
      .diffs()
      .filter(filterRenderableDiff)
      .find((diff) => diff.file === value)
  })

  return (
    // Key on the file path, not the diff object identity, so refreshed diff data
    // updates the mounted preview instead of remounting the whole viewer.
    <Show when={path()} keyed fallback={<FileTabContent tab={props.tab} embedded />}>
      {(file) => (
        <Show when={diffItem()} fallback={<FileTabContent tab={props.tab} embedded />}>
          {(diff) => (
            <div data-component="session-review-v2" class="flex flex-col h-full min-h-0 overflow-hidden">
              <SessionReviewFilePreviewV2
                file={file}
                diff={diff()}
                diffStyle={review().diffStyle}
                expandMode={review().state.expandMode()}
                readFile={readFile}
                onLineComment={review().onLineComment}
                onLineCommentUpdate={review().onLineCommentUpdate}
                onLineCommentDelete={review().onLineCommentDelete}
                lineCommentActions={review().lineCommentActions}
                comments={review().comments}
                focusedComment={review().focusedComment}
                onFocusedCommentChange={review().onFocusedCommentChange}
              />
            </div>
          )}
        </Show>
      )}
    </Show>
  )
}
