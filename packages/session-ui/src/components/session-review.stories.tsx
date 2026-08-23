import { CurrentSessionProviders } from "../storybook/current-session-story"
import { editThenTestDocument, reviewDiffs } from "../storybook/current-session-fixtures"
import { SessionReview } from "./session-review"

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
