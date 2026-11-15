import { render } from "solid-js/web"
import { createSignal } from "solid-js"
import { CurrentSessionProviders } from "../src/storybook/current-session-story"
import { editThenTestDocument } from "../src/storybook/current-session-fixtures"
import { SessionReviewFilePreviewV2 } from "../src/v2/components/session-review-file-preview-v2"

const [edits, setEdits] = createSignal(0)

export const controls = {
  /** The agent edits the file again, so the diff redraws under any open draft. */
  edit: () => setEdits((count) => count + 1),
}

export function mountReview() {
  const element = document.createElement("div")
  element.dataset.testid = "review-fixture"
  element.style.cssText = "position: fixed; inset: 0 auto auto 0; z-index: 1; width: 800px; background: white"
  document.body.appendChild(element)

  render(
    () => (
      <CurrentSessionProviders document={editThenTestDocument}>
        <SessionReviewFilePreviewV2
          file="src/review.ts"
          diff={{
            file: "src/review.ts",
            additions: 1,
            deletions: 1,
            status: "modified",
            patch: `diff --git a/src/review.ts b/src/review.ts\n--- a/src/review.ts\n+++ b/src/review.ts\n@@ -1,3 +1,3 @@\n export const first = 1\n-export const value = 'before'\n+export const value = 'after ${edits()}'\n export const last = 3\n`,
          }}
          diffStyle="unified"
          comments={[]}
          onLineComment={() => {}}
        />
      </CurrentSessionProviders>
    ),
    element,
  )
}
