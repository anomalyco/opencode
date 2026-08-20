import {
  activePermissionRequest,
  activeQuestionRequest,
  attachmentsAndCommentsDocument,
  editThenTestDocument,
  emptySessionDocument,
  largeCompletedDocument,
  pendingAndQueuedDocument,
  permissionPendingDocument,
  questionPendingDocument,
  queuedPrompts,
  recoveryDocument,
  thinkingDocument,
} from "@opencode-ai/session-ui/storybook"
import { SessionPreview } from "./session-preview"

const description = "opencode · modular-session-ui"
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
          "A server-free Session workbench for product and design review. It composes the production current timeline, titlebar actions, composer region, prompt input, request docks, queue, and review components.",
      },
    },
  },
}

export const StartACodingTask = {
  render: () => (
    <SessionPreview
      title="New Session"
      description={description}
      document={emptySessionDocument}
      draft="Find why the Session header shifts after the first streamed response"
    />
  ),
}

export const AgentIsThinking = {
  render: () => (
    <SessionPreview title="Fix Session header shift" description={description} document={thinkingDocument} />
  ),
}

export const ImplementAndVerifyLight = {
  globals: { theme: "light" },
  render: implementAndVerify,
}

export const ImplementAndVerifyDark = {
  globals: { theme: "dark" },
  render: implementAndVerify,
}

export const QueueAFollowUp = {
  render: () => (
    <SessionPreview
      title="Add deterministic Session stories"
      description={description}
      document={pendingAndQueuedDocument}
      followups={queuedPrompts}
      backgroundTasks={[{ id: "task_storybook", type: "subagent", label: "Review the current Storybook scenarios" }]}
    />
  ),
}

export const PermissionRequired = {
  render: () => (
    <SessionPreview
      title="Publish canary preview"
      description={description}
      document={permissionPendingDocument}
      request={{ type: "permission", value: activePermissionRequest }}
    />
  ),
}

export const AnswerAProductQuestion = {
  render: () => (
    <SessionPreview
      title="Add the Session review panel"
      description={description}
      document={questionPendingDocument}
      request={{ type: "question", value: activeQuestionRequest }}
    />
  ),
}

export const ReviewChanges = {
  render: () => (
    <SessionPreview
      title="Update active Session status"
      description={description}
      document={editThenTestDocument}
      reviewOpened
    />
  ),
}

export const RecoverFromAFailedTest = {
  render: () => (
    <SessionPreview
      title="Keep tool disclosure stable"
      description={description}
      document={recoveryDocument}
      draft="Also run the App browser test"
    />
  ),
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
      description="opencode · packages/app/src/session.tsx"
      document={attachmentsAndCommentsDocument}
      draft="راجع المسار packages/app/src/session.tsx ثم شغّل bun test"
    />
  ),
}
