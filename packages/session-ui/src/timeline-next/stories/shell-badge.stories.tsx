import type { SessionDocument } from "../../document"
import { CURRENT_SESSION_ID, STORY_MODEL, STORY_TIME } from "../../storybook/current-session-fixtures"
import { CurrentSessionProviders } from "../../storybook/current-session-story"
import { timelinePresets } from "../../timeline/detail"
import { NextSessionTimeline } from "./session-timeline"

export default {
  title: "OpenCode/Timeline/Shell badge",
  id: "timeline-next-shell-badge",
  component: NextSessionTimeline,
  parameters: { layout: "fullscreen" },
}

const document = {
  sessionID: CURRENT_SESSION_ID,
  messages: [
    {
      id: "msg_shell_badge_user",
      type: "user",
      text: "Run the build and tell me what failed.",
      time: { created: STORY_TIME },
      metadata: { agent: "build", model: STORY_MODEL },
    },
    {
      id: "msg_shell_badge_assistant",
      type: "assistant",
      agent: "build",
      model: STORY_MODEL,
      content: [
        {
          type: "tool",
          id: "tool_shell_badge",
          name: "shell",
          state: {
            status: "completed",
            input: {
              command: "cd /very/long/path/to/the/project && bun run build --filter=@opencode/session-ui --force",
            },
            content: [{ type: "text", text: "error: build failed" }],
            metadata: { exit: 1 },
          },
          time: { created: STORY_TIME + 100, ran: STORY_TIME + 200, completed: STORY_TIME + 900 },
        },
      ],
      time: { created: STORY_TIME + 100, completed: STORY_TIME + 1000 },
    },
  ],
  status: { type: "idle" },
  diffs: [],
} satisfies SessionDocument

const compact = timelinePresets.find((preset) => preset.id === "compact")!.value

export const FailedBadge = {
  render: () => (
    <section class="mx-auto w-full max-w-[420px] p-6">
      <CurrentSessionProviders document={document}>
        <NextSessionTimeline document={document} timelineDetail={compact} />
      </CurrentSessionProviders>
    </section>
  ),
}
