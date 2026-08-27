import { createStore } from "solid-js/store"
import { CurrentSessionProviders } from "../storybook/current-session-story"
import { editThenTestDocument, reviewDiffs } from "../storybook/current-session-fixtures"
import { SessionReview, type SessionReviewComment } from "./session-review"

function ReviewStory(props: { split?: boolean }) {
  return (
    <CurrentSessionProviders document={editThenTestDocument}>
      <div class="mx-auto h-screen min-h-[620px] w-full max-w-[1100px] overflow-hidden bg-background-base">
        <SessionReview
          title="Changes in this Session"
          diffs={reviewDiffs}
          open={reviewDiffs.map((diff) => diff.file)}
          split={props.split}
        />
      </div>
    </CurrentSessionProviders>
  )
}

export default {
  title: "OpenCode/Review/Changed files",
  id: "components-session-review",
  component: SessionReview,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "The production inline review surface with current Session diffs. Expand files, switch the view, and inspect the same content in both color schemes.",
      },
    },
  },
}

export const Unified = {
  render: () => <ReviewStory />,
}

export const Split = {
  render: () => <ReviewStory split />,
}

export const UnifiedDark = {
  globals: { theme: "dark" },
  render: () => <ReviewStory />,
}

function InteractiveCommentsStory() {
  const [state, setState] = createStore({ comments: [] as SessionReviewComment[] })
  const file = "src/review.ts"
  const diffs = [
    {
      file,
      additions: 1,
      deletions: 1,
      status: "modified" as const,
      patch:
        "diff --git a/src/review.ts b/src/review.ts\n--- a/src/review.ts\n+++ b/src/review.ts\n@@ -1,3 +1,3 @@\n export const first = 1\n-export const value = 'before'\n+export const value = 'after'\n export const last = 3\n",
    },
  ]
  return (
    <CurrentSessionProviders document={editThenTestDocument}>
      <div class="mx-auto h-screen min-h-[620px] w-full max-w-[900px] overflow-hidden bg-background-base">
        <SessionReview
          title="Changes in this Session"
          diffs={diffs}
          open={[file]}
          comments={state.comments}
          onLineComment={(comment) =>
            setState("comments", (comments) => [...comments, { id: `comment-${comments.length + 1}`, ...comment }])
          }
        />
      </div>
    </CurrentSessionProviders>
  )
}

export const InteractiveComments = { render: () => <InteractiveCommentsStory /> }
