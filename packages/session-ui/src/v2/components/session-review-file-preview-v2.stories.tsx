import { CurrentSessionProviders } from "../../storybook/current-session-story"
import { editThenTestDocument } from "../../storybook/current-session-fixtures"
import { SessionReviewFilePreviewV2 } from "./session-review-file-preview-v2"

export default {
  title: "OpenCode/Review/File preview",
  id: "review-file-preview-v2",
}

export const CopySnapshot = {
  args: { empty: false, reader: true },
  render: (args: { empty: boolean; reader: boolean }) => (
    <CurrentSessionProviders document={editThenTestDocument}>
      <div data-component="session-review-v2" style={{ height: "400px" }}>
        <SessionReviewFilePreviewV2
          file="example.ts"
          diff={{
            file: "example.ts",
            before: "export const value = 'before'\n",
            after: args.empty ? "" : "export const value = 'reviewed'\n// unchanged beyond the edit\n",
            additions: args.empty ? 0 : 2,
            deletions: 1,
            status: "modified",
          }}
          diffStyle="unified"
          readFile={args.reader ? async () => ({ type: "text", content: "later disk contents\n" }) : undefined}
        />
      </div>
    </CurrentSessionProviders>
  ),
}
