import type { SessionDocument } from "../document"
import { CURRENT_SESSION_ID, LAB_MODEL, LAB_TIME } from "../lab/current-session-fixtures"
import { CurrentSessionProviders } from "../lab/current-session-lab"
import { timelinePresets } from "./detail"
import { SessionTimeline } from "./session-timeline"

export default {
  title: "OpenCode/Conversation/Error spacing",
  id: "current-session-error-spacing",
  component: SessionTimeline,
  parameters: { layout: "fullscreen" },
}

const document = {
  sessionID: CURRENT_SESSION_ID,
  status: { type: "idle" },
  diffs: [],
  messages: [
    {
      id: "msg_user_shell_error",
      type: "user",
      text: "Check the shell command and its result.",
      metadata: { agent: "build", model: LAB_MODEL },
      time: { created: LAB_TIME },
    },
    {
      id: "msg_shell_error",
      type: "assistant",
      agent: "build",
      model: LAB_MODEL,
      content: [
        {
          type: "tool",
          id: "tool_shell_error",
          name: "shell",
          state: {
            status: "completed",
            input: { command: "cd ~/Documents/Local/opencode && ls packages/tui" },
            content: [{ type: "text", text: "AGENTS.md\nbunfig.toml\nnode_modules\npackage.json\nsrc" }],
            metadata: {},
          },
          time: { created: LAB_TIME + 100, ran: LAB_TIME + 150, completed: LAB_TIME + 300 },
        },
      ],
      error: { type: "ProviderError", message: "getaddrinfo ENOTFOUND opencode.ai" },
      time: { created: LAB_TIME + 50, completed: LAB_TIME + 400 },
    },
    {
      id: "msg_after_error_updates",
      type: "system",
      description: "Instructions updated: core/codemode, core/mcp-guidance",
      text: "Instructions updated: core/codemode, core/mcp-guidance",
      time: { created: LAB_TIME + 500 },
    },
  ],
} satisfies SessionDocument

export const ErrorAndUpdates = {
  args: { preset: "detailed" },
  argTypes: { preset: { options: timelinePresets.map((preset) => preset.id) } },
  render: (args: { preset: string }) => (
    <section class="mx-auto min-h-screen w-full max-w-[720px] bg-v2-background-bg-base p-6">
      <CurrentSessionProviders document={document}>
        <SessionTimeline
          document={document}
          timelineDetail={timelinePresets.find((preset) => preset.id === args.preset)!.value}
        />
      </CurrentSessionProviders>
    </section>
  ),
}
