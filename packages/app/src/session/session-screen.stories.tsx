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
import type { SubagentStatus } from "./composer/subagent-bar"
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

export const QuestionAnswerCounts = {
  render: () => (
    <SessionPreview
      title="Choose supporting surfaces"
      description={description}
      document={questionPendingDocument}
      request={{
        type: "question",
        value: {
          ...activeQuestionRequest,
          fields: [
            activeQuestionRequest.fields[0],
            {
              ...activeQuestionRequest.fields[1],
              options: [...activeQuestionRequest.fields[1].options, { value: "diagnostics", label: "Diagnostics" }],
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
    />
  ),
}

export const ChildSession = {
  args: { status: "running", title: "Trace why the sidebar flickers on resize", permission: false },
  argTypes: { status: { control: "select", options: ["running", "succeeded", "failed", "interrupted"] } },
  render: (args: { status: SubagentStatus; title: string; permission: boolean }) => (
    <SessionPreview
      title="Inspect the child Session"
      description={description}
      document={args.permission ? permissionPendingDocument : subagentDocument}
      request={args.permission ? { type: "permission", value: activePermissionRequest } : undefined}
      child={{
        agent: "surveyor",
        title: args.title,
        model: { provider: "Anthropic", name: "Claude Opus 5.5", variant: "high" },
        status: args.status,
        started: Date.now() - 65_000,
        ended: args.status === "running" ? undefined : Date.now() + 187_000,
      }}
    />
  ),
}

export const ChildSessionDone = {
  render: () => (
    <SessionPreview
      title="Inspect a finished child Session"
      description={description}
      document={subagentDocument}
      child={{
        agent: "surveyor",
        title: "Map every caller of the legacy theme tokens",
        model: { provider: "Anthropic", name: "Claude Opus 5.5", variant: "high" },
        status: "succeeded",
        started: 0,
        ended: 252_000,
      }}
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
