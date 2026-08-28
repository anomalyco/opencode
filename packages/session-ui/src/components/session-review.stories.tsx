import { createStore } from "solid-js/store"
import { parseDiffFromFile } from "@pierre/diffs"
import { CurrentSessionProviders } from "../storybook/current-session-story"
import { editThenTestDocument, reviewDiffs } from "../storybook/current-session-fixtures"
import { File } from "./file"
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

const gitDiffs = [
  {
    // OpenCode 93e1f383dd79683af4fc5ad139cea0516603c838, unchanged git-show output.
    file: "packages/session-ui/src/components/file.tsx",
    additions: 1,
    deletions: 1,
    patch: `diff --git a/packages/session-ui/src/components/file.tsx b/packages/session-ui/src/components/file.tsx
index 704971b014..4876731cbd 100644
--- a/packages/session-ui/src/components/file.tsx
+++ b/packages/session-ui/src/components/file.tsx
@@ -702,7 +702,7 @@ function ViewerShell(props: {
       data-mode={props.mode}
       dir="ltr"
       style={styleVariables}
-      class="relative outline-none"
+      class="relative select-text outline-none"
       classList={{
         ...props.classList,
         [props.class ?? ""]: !!props.class,
`,
  },
  {
    // OpenCode 497a24c17d, unchanged git-show output.
    file: "packages/core/src/session/runner/retry.ts",
    additions: 1,
    deletions: 1,
    patch: `diff --git a/packages/core/src/session/runner/retry.ts b/packages/core/src/session/runner/retry.ts
index 10f6680097..ef26792ffe 100644
--- a/packages/core/src/session/runner/retry.ts
+++ b/packages/core/src/session/runner/retry.ts
@@ -15,7 +15,7 @@ export interface Input {
 }
\x20
 export function isRetryable(error: AIError) {
-  const override = "http" in error.reason ? error.reason.http?.response?.headers["x-should-retry"] : undefined
+  const override = error.reason.http?.headers["x-should-retry"]
   if (override === "true") return true
   if (override === "false") return false
   switch (error.reason._tag) {
`,
  },
]

export const InlineChanges = {
  args: { split: false },
  render: (args: { split: boolean }) => (
    <CurrentSessionProviders document={editThenTestDocument}>
      <div class="mx-auto h-screen min-h-[620px] w-full max-w-[1100px] overflow-hidden bg-background-base">
        <SessionReview
          title="OpenCode Git history"
          diffs={gitDiffs}
          open={gitDiffs.map((diff) => diff.file)}
          split={args.split}
        />
      </div>
    </CurrentSessionProviders>
  ),
}

export const LargeFile = {
  args: { split: false, source: "files" },
  argTypes: { source: { control: "select", options: ["files", "metadata"] } },
  render: (args: { split: boolean; source: string }) => {
    // Cross the viewer's 500,000-character limit without long changed lines or 1,000 total lines.
    const padding = `// ${"unchanged ".repeat(70)}\n`.repeat(800)
    const before = { name: "large.ts", contents: `export const value = 'before'\n${padding}` }
    const after = { name: "large.ts", contents: `export const value = 'after'\n${padding}` }
    const input = args.source === "metadata" ? { fileDiff: parseDiffFromFile(before, after) } : { before, after }
    return (
      <div class="h-screen overflow-auto bg-background-base">
        <File mode="diff" {...input} diffStyle={args.split ? "split" : "unified"} />
      </div>
    )
  },
}
