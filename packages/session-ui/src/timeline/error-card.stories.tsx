import type { SessionDocument } from "../document"
import { CURRENT_SESSION_ID, STORY_MODEL, STORY_TIME, thinkingDocument } from "../storybook/current-session-fixtures"
import { CurrentSessionTimelineStory } from "../storybook/current-session-story"
import { SessionTimeline } from "./session-timeline"

export default {
  title: "OpenCode/Conversation/Error card",
  id: "current-session-error-card",
  component: SessionTimeline,
  parameters: { layout: "fullscreen" },
}

const document = {
  sessionID: CURRENT_SESSION_ID,
  messages: [
    ...thinkingDocument.messages,
    {
      id: "msg_story_error_short",
      type: "assistant",
      agent: "build",
      model: STORY_MODEL,
      content: [],
      error: { type: "provider.content-filter", message: "Provider blocked the response: Request declined." },
      time: { created: STORY_TIME + 33_000, completed: STORY_TIME + 34_000 },
    },
    { id: "msg_story_error_retry", type: "user", text: "Try again.", time: { created: STORY_TIME + 34_500 } },
    {
      id: "msg_story_error_long",
      type: "assistant",
      agent: "build",
      model: STORY_MODEL,
      content: [],
      error: {
        type: "provider.content-filter",
        message:
          "Provider blocked the response: This request could not be completed. Check the provider's documentation for the applicable policy, then try a different approach or model.",
      },
      time: { created: STORY_TIME + 35_000, completed: STORY_TIME + 36_000 },
    },
  ],
  status: { type: "idle" },
  diffs: [],
} satisfies SessionDocument

export const ProviderErrors = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Provider errors"
      description="Short and wrapped provider errors in the production timeline."
      document={document}
      width="480px"
    />
  ),
}
