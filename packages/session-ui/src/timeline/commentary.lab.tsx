import type { SessionMessageAssistant } from "@opencode/client/promise"
import type { SessionDocument } from "../document"
import { CURRENT_SESSION_ID, LAB_MODEL, LAB_TIME } from "../lab/current-session-fixtures"
import { labTool } from "../lab/current-session-scenarios"
import { CurrentSessionProviders } from "../lab/current-session-lab"
import { timelinePresets, type TimelinePlacement } from "./detail"
import { SessionTimeline } from "./session-timeline"

export default {
  title: "OpenCode/Conversation/Commentary",
  id: "current-session-commentary",
  component: SessionTimeline,
  parameters: { layout: "fullscreen" },
  args: { commentary: "grouped" },
  argTypes: { commentary: { control: { type: "inline-radio" }, options: ["separate", "grouped", "hidden"] } },
}

const step = (id: string, offset: number, content: SessionMessageAssistant["content"]) =>
  ({
    id,
    type: "assistant",
    agent: "build",
    model: LAB_MODEL,
    content,
    time: { created: LAB_TIME + offset, completed: LAB_TIME + offset + 900 },
  }) satisfies SessionDocument["messages"][number]

const document = {
  sessionID: CURRENT_SESSION_ID,
  status: { type: "idle" },
  diffs: [],
  messages: [
    {
      id: "msg_commentary_user",
      type: "user",
      text: "The timeline setting resets after a restart. Can you fix it?",
      metadata: { agent: "build", model: LAB_MODEL },
      time: { created: LAB_TIME },
    },
    step("msg_commentary_1", 100, [
      { type: "text", text: "I'll find where the timeline setting is stored." },
      labTool("commentary_grep", "grep", "completed", { pattern: "timelineDetail" }),
      labTool("commentary_read", "read", "completed", { filePath: "src/settings/model.tsx" }),
    ]),
    step("msg_commentary_2", 1100, [
      { type: "text", text: "The stored value is missing the new category, so decoding falls back. Running the tests." },
      labTool("commentary_shell", "shell", "completed", { command: "bun test settings" }, { output: "12 pass" }),
    ]),
    step("msg_commentary_3", 2100, [
      { type: "text", text: "Tests pass. Writing up the fix.", native: { phase: "commentary" } },
      {
        type: "text",
        text: "Fixed. Stored settings that lack a category now take that category from the default preset, so the value survives a restart.",
      },
    ]),
  ],
} satisfies SessionDocument

export const Placement = {
  render: (args: { commentary: TimelinePlacement }) => (
    <section class="mx-auto min-h-screen w-full max-w-[720px] bg-v2-background-bg-base p-6">
      <CurrentSessionProviders document={document}>
        <SessionTimeline
          document={document}
          timelineDetail={{ ...timelinePresets[2].value, commentary: { placement: args.commentary } }}
        />
      </CurrentSessionProviders>
    </section>
  ),
}
