import { SessionTimeline } from "./session-timeline"
import { CurrentSessionTimelineStory } from "../storybook/current-session-story"
import {
  attachmentsAndCommentsDocument,
  attachmentsAndCommentsPresentation,
  compactionDocument,
  editThenTestDocument,
  requestHistoryDocument,
  retryDocument,
  shellStatesDocument,
  streamingDocument,
  subagentDocument,
} from "../storybook/current-session-fixtures"

export default {
  title: "Current Session/Timeline Rows",
  id: "current-session-timeline-rows",
  component: SessionTimeline,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Focused production row rendering through `SessionTimeline`. These narrow documents keep projection, current message adapters, tool rendering, and row framing in the test surface.",
      },
    },
  },
}

export const StreamingAssistantRow = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Streaming assistant row"
      description="One user root with current reasoning and text content."
      document={streamingDocument}
      width="560px"
    />
  ),
}

export const EditAndExecutionRows = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Edit and execution rows"
      description="A narrow current document renders the production edit, shell, and result rows."
      document={editThenTestDocument}
      width="620px"
      editToolDefaultOpen
      shellToolDefaultOpen
    />
  ),
}

export const ShellRows = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Shell rows"
      description="Running and failed standalone shell rows at a compact width."
      document={shellStatesDocument}
      width="560px"
      shellToolDefaultOpen
    />
  ),
}

export const QuestionAndErrorRows = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Question and permission error rows"
      description="A completed answer and denied command use the real question and error tool renderers."
      document={requestHistoryDocument}
      width="620px"
      shellToolDefaultOpen
    />
  ),
}

export const RetryRow = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Retry row"
      description="The active retry status is projected from the latest current assistant message."
      document={retryDocument}
      width="520px"
    />
  ),
}

export const CompactionRows = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Compaction rows"
      description="Output, compaction notice, and continued output remain in chronological order."
      document={compactionDocument}
      width="600px"
    />
  ),
}

export const SubagentRows = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Subagent rows"
      description="Completed and active child Session tools use production task cards."
      document={subagentDocument}
      width="580px"
    />
  ),
}

export const AttachmentAndCommentRow = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Attachment and comment row"
      description="One production user row contains files, an agent mention, and a line comment."
      document={attachmentsAndCommentsDocument}
      presentation={attachmentsAndCommentsPresentation}
      width="480px"
    />
  ),
}

export const MixedDirectionRtl = {
  render: () => (
    <div dir="rtl">
      <CurrentSessionTimelineStory
        title="Mixed direction and RTL"
        description="Forced RTL layout with Latin paths, current attachments, and line comments."
        document={attachmentsAndCommentsDocument}
        presentation={attachmentsAndCommentsPresentation}
        width="480px"
      />
    </div>
  ),
}
