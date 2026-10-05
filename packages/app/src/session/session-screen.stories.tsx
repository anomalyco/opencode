import {
  activePermissionRequest,
  activeQuestionRequest,
  attachmentsAndCommentsDocument,
  compactionDocument,
  editThenTestDocument,
  emptySessionDocument,
  largeCompletedDocument,
  permissionPendingDocument,
  questionPendingDocument,
  retryDocument,
  streamingDocument,
  STORY_TIME,
  subagentDocument,
  terminalPassedDocument,
} from "@opencode/session-ui/storybook"
import { SessionPreview } from "./story-model"

const description = "opencode · modular-session-ui"
const retryAfterInterruption = {
  ...retryDocument,
  messages: [
    ...compactionDocument.messages,
    ...retryDocument.messages.map((message, index) => {
      const created = STORY_TIME + 70_000 + index * 1_000
      if (message.type !== "assistant" || !message.retry) {
        return { ...message, time: { ...message.time, created } }
      }
      return {
        ...message,
        time: { ...message.time, created },
        retry: { ...message.retry, at: created },
      }
    }),
  ],
}
const implementAndVerify = () => (
  <SessionPreview
    title="Update active Session status"
    description={description}
    document={editThenTestDocument}
    draft="Add a browser assertion for the updated status"
  />
)

export default {
  title: "OpenCode/Session/Complete workspace",
  id: "app-current-session-surface",
  component: SessionPreview,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "A server-free Session workbench for product and design review. It composes the production current timeline, titlebar actions, Composer, request docks, and review components.",
      },
    },
  },
}

export const ImplementAndVerifyLight = {
  globals: { theme: "light" },
  render: implementAndVerify,
}

export const ImplementAndVerifyDark = {
  globals: { theme: "dark" },
  render: implementAndVerify,
}

export const WorkFromAttachments = {
  render: () => (
    <SessionPreview
      title="Fix narrow Session spacing"
      description={description}
      document={attachmentsAndCommentsDocument}
      draft="Verify the same layout at 360 px"
    />
  ),
}

export const LongRunningSession = {
  render: () => (
    <SessionPreview
      title="Modularize Session rendering"
      description={description}
      document={largeCompletedDocument}
      draft="Summarize the remaining verification"
    />
  ),
}

export const MixedDirectionRtl = {
  globals: { theme: "dark", direction: "rtl" },
  render: () => (
    <SessionPreview
      title="مراجعة واجهة Session"
      description="opencode · packages/app/src/session/screen.tsx"
      document={attachmentsAndCommentsDocument}
      draft="راجع المسار packages/app/src/session/screen.tsx ثم شغّل bun test"
    />
  ),
}

export const EmptySession = {
  render: () => <SessionPreview title="New Session" description={description} document={emptySessionDocument} />,
}

export const StreamingSession = {
  render: () => (
    <SessionPreview title="Stream the Session response" description={description} document={streamingDocument} />
  ),
}

export const EditThenShellTest = {
  render: implementAndVerify,
}

export const PermissionRequest = {
  render: () => (
    <SessionPreview
      title="Publish canary preview"
      description={description}
      document={permissionPendingDocument}
      request={{ type: "permission", value: activePermissionRequest }}
    />
  ),
}

export const QuestionRequest = {
  render: () => (
    <SessionPreview
      title="Add the Session review panel"
      description={description}
      document={questionPendingDocument}
      request={{ type: "question", value: activeQuestionRequest }}
    />
  ),
}

export const LongQuestionRequest = {
  render: () => (
    <SessionPreview
      title="Review the mobile question layout"
      description={description}
      document={questionPendingDocument}
      request={{
        type: "question",
        value: {
          ...activeQuestionRequest,
          id: "frm_long_question_preview",
          fields: [
            {
              key: "approach",
              type: "string",
              title: "Approach",
              description: "Which approach should we use for the mobile layout?",
              options: Array.from({ length: 12 }, (_, index) => ({
                value: `approach-${index + 1}`,
                label: `Approach ${index + 1}: keep all question controls reachable on a narrow screen`,
                description:
                  "Allow the question and its options to scroll while keeping navigation and submission available, including when the browser toolbar reduces the available height.",
              })),
            },
            {
              key: "checks",
              type: "multiselect",
              title: "Checks",
              description: Array.from(
                { length: 12 },
                () =>
                  "Review the question on a narrow mobile screen with the browser toolbar visible. Confirm that every option can be reached and that the selected answers remain available when navigating back.",
              ).join("\n\n"),
              options: [
                { value: "portrait", label: "Portrait" },
                { value: "landscape", label: "Landscape" },
              ],
            },
          ],
        },
      }}
    />
  ),
}

export const WebSearchRequest = {
  render: () => (
    <SessionPreview
      title="Search for current documentation"
      description={description}
      document={questionPendingDocument}
      request={{
        type: "websearch",
        value: {
          id: "frm_websearch_preview",
          sessionID: "ses_websearch_preview",
          title: "Web Search",
          metadata: { kind: "websearch.provider" },
          fields: [{ key: "choice", type: "string", required: true, custom: false }],
        },
      }}
    />
  ),
}

export const RetryAndInterruption = {
  render: () => (
    <SessionPreview title="Recover the interrupted run" description={description} document={retryAfterInterruption} />
  ),
}

export const ReviewPlusTerminal = {
  render: () => (
    <SessionPreview
      title="Review the terminal verification"
      description={description}
      document={{ ...terminalPassedDocument, diffs: editThenTestDocument.diffs }}
      reviewOpened
      terminal={{ title: "Terminal 1", lines: ["$ bun test", "27 pass", "0 fail"] }}
    />
  ),
}

export const ChildSession = {
  render: () => (
    <SessionPreview
      title="Inspect the child Session"
      description={description}
      document={subagentDocument}
      child={{ parentID: "ses_story_parent" }}
    />
  ),
}

export const MobileLayout = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
  parameters: { viewport: { defaultViewport: "mobile1" } },
  render: () => (
    <SessionPreview
      title="Review the mobile Session"
      description={description}
      document={attachmentsAndCommentsDocument}
    />
  ),
}

export const NarrowLayout = {
  globals: { viewport: { value: "tablet", isRotated: false } },
  parameters: { viewport: { defaultViewport: "tablet" } },
  render: () => (
    <SessionPreview
      title="Review the narrow Session"
      description={description}
      document={editThenTestDocument}
      reviewOpened
    />
  ),
}
