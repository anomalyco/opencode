import { SessionTimeline } from "./session-timeline"
import { CurrentSessionTimelineStory } from "../storybook/current-session-story"
import {
  attachmentsAndCommentsDocument,
  attachmentsAndCommentsPresentation,
  compactionDocument,
  instructionsUpdatedMultipleDocument,
  instructionsUpdatedSingleDocument,
  requestHistoryDocument,
  retryDocument,
  revertDocument,
  streamingDocument,
  thinkingDocument,
} from "../storybook/current-session-fixtures"

export default {
  title: "OpenCode/Conversation/Message states",
  id: "current-session-timeline-rows",
  component: SessionTimeline,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Focused current-message states rendered through the production timeline projection and message components.",
      },
    },
  },
}

export const AgentThinking = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Agent thinking"
      description="The prompt is admitted and the active turn is waiting for its first visible content."
      document={thinkingDocument}
      width="560px"
    />
  ),
}

export const StreamingReasoningAndText = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Streaming reasoning and text"
      description="The active turn contains a reasoning summary and a partial response."
      document={streamingDocument}
      width="560px"
    />
  ),
}

export const ProviderRetry = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Provider retry"
      description="A temporary provider limit keeps the turn active and explains the scheduled retry."
      document={retryDocument}
      width="520px"
    />
  ),
}

export const CompactionAndContinuation = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Compaction and continuation"
      description="The context summary separates earlier output from the continued response."
      document={compactionDocument}
      width="600px"
    />
  ),
}

export const AnsweredQuestionAndDeclinedCommand = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Answered question and declined command"
      description="The chosen answer remains in history, and the declined command keeps its user-visible result."
      document={requestHistoryDocument}
      width="620px"
      shellToolDefaultOpen
    />
  ),
}

export const RevertBoundary = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Revert boundary"
      description="The latest user message exposes the production revert action for choosing a rollback point."
      document={revertDocument}
      width="620px"
    />
  ),
}

export const PromptWithAttachments = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Prompt with attachments"
      description="A user message combines text, two files, an agent mention, and a selected-line comment."
      document={attachmentsAndCommentsDocument}
      presentation={attachmentsAndCommentsPresentation}
      width="480px"
    />
  ),
}

export const MixedDirectionRtl = {
  globals: { direction: "rtl" },
  render: () => (
    <CurrentSessionTimelineStory
      title="Mixed-direction prompt in RTL"
      description="Forced RTL keeps file paths and code readable without changing the message order."
      document={attachmentsAndCommentsDocument}
      presentation={attachmentsAndCommentsPresentation}
      width="480px"
    />
  ),
}

export const InstructionsUpdatedSingle = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Instructions updated (single)"
      description="A system notice in the timeline showing a single updated instruction source."
      document={instructionsUpdatedSingleDocument}
      width="600px"
    />
  ),
}

export const InstructionsUpdatedMultiple = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Instructions updated (multiple)"
      description="A system notice in the timeline showing multiple updated instruction sources."
      document={instructionsUpdatedMultipleDocument}
      width="600px"
    />
  ),
}
