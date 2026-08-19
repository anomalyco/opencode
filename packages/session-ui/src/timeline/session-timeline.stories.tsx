import { For } from "solid-js"
import { SessionTimeline } from "./session-timeline"
import { CurrentSessionTimelineStory } from "../storybook/current-session-story"
import {
  attachmentsAndCommentsDocument,
  attachmentsAndCommentsPresentation,
  compactionDocument,
  editThenTestDocument,
  emptySessionDocument,
  largeCompletedDocument,
  pendingAndQueuedDocument,
  queuedPrompts,
  requestHistoryDocument,
  retryDocument,
  revertDocument,
  shellStatesDocument,
  streamingDocument,
  subagentDocument,
} from "../storybook/current-session-fixtures"

export default {
  title: "Current Session/SessionTimeline",
  id: "current-session-timeline",
  component: SessionTimeline,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "The real current `SessionTimeline`, driven by deterministic `SessionDocument` fixtures and current nested assistant content. Every story has a local reset that remounts expanded rows and clears story actions.",
      },
    },
  },
}

export const EmptySession = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Empty Session"
      description="No projected rows. The bordered stage is the real, empty SessionTimeline surface."
      document={emptySessionDocument}
    />
  ),
}

export const PendingAndQueuedPrompts = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Pending and queued prompts"
      description="The admitted prompt is visible and busy. Queue delivery remains outside the timeline until promotion."
      document={pendingAndQueuedDocument}
      note={
        <aside class="rounded-lg border border-border-weak-base bg-background-weak px-3 py-2">
          <div class="text-12-medium text-text-strong">Queued outside the projected timeline</div>
          <div class="mt-1 flex flex-col gap-1 text-12-regular text-text-weak">
            <For each={queuedPrompts}>{(item) => <div>{item.text}</div>}</For>
          </div>
        </aside>
      }
    />
  ),
}

export const StreamingTextAndReasoning = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Streaming text and reasoning"
      description="A busy assistant message has live reasoning and a partial text response."
      document={streamingDocument}
    />
  ),
}

export const EditThenTest = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Edit then test"
      description="The current assistant message contains a completed edit, a shell test, and its result."
      document={editThenTestDocument}
      editToolDefaultOpen
      shellToolDefaultOpen
    />
  ),
}

export const RunningAndFailedShell = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Running and failed shell"
      description="Standalone current shell messages cover an active process and a non-zero exit."
      document={shellStatesDocument}
      shellToolDefaultOpen
    />
  ),
}

export const PermissionAndQuestionHistory = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Permission and question history"
      description="An answered question remains in history and a denied command keeps its tool error. Active request docks are covered on the App surface."
      document={requestHistoryDocument}
      shellToolDefaultOpen
    />
  ),
}

export const Retry = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Retry"
      description="The active assistant step carries a fixed provider retry attempt and deadline."
      document={retryDocument}
    />
  ),
}

export const Compaction = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Compaction"
      description="A completed compaction notice stays between pre-compaction and continued assistant output."
      document={compactionDocument}
    />
  ),
}

export const SubagentWork = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Subagent work"
      description="One child Session is complete while a second task remains active."
      document={subagentDocument}
    />
  ),
}

export const AttachmentsAndComments = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Attachments and comments"
      description="The user row uses current file and agent attachments plus a typed line comment presentation."
      document={attachmentsAndCommentsDocument}
      presentation={attachmentsAndCommentsPresentation}
    />
  ),
}

export const Revert = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Revert boundary"
      description="Use the latest user row action to select the local revert boundary, then use Reset to clear it."
      document={revertDocument}
    />
  ),
}

export const LargeCompletedSession = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Large completed Session"
      description="Sixteen deterministic completed turns exercise row spacing, context groups, markdown, and long scrolling."
      document={largeCompletedDocument}
      width="1000px"
    />
  ),
}
