import type { SessionDocument } from "../document"
import { CURRENT_SESSION_ID, LAB_MODEL, LAB_TIME, thinkingDocument } from "../lab/current-session-fixtures"
import { CurrentSessionTimelineLab } from "../lab/current-session-lab"
import { SessionTimeline } from "./session-timeline"

export default {
  title: "OpenCode/Conversation/Error card",
  id: "current-session-error-card",
  component: SessionTimeline,
  parameters: { layout: "fullscreen" },
  args: { width: 480 },
  argTypes: { width: { control: { type: "range", min: 320, max: 960, step: 10 } } },
}

const document = {
  sessionID: CURRENT_SESSION_ID,
  messages: [
    ...thinkingDocument.messages,
    {
      id: "msg_lab_error_short",
      type: "assistant",
      agent: "build",
      model: LAB_MODEL,
      content: [],
      error: { type: "provider.content-filter", message: "Provider blocked the response: Request declined." },
      time: { created: LAB_TIME + 33_000, completed: LAB_TIME + 34_000 },
    },
    { id: "msg_lab_error_retry", type: "user", text: "Try again.", time: { created: LAB_TIME + 34_500 } },
    {
      id: "msg_lab_error_long",
      type: "assistant",
      agent: "build",
      model: LAB_MODEL,
      content: [],
      error: {
        type: "provider.content-filter",
        message:
          "Provider blocked the response: This request could not be completed. Check the provider's documentation for the applicable policy, then try a different approach or model.",
      },
      time: { created: LAB_TIME + 35_000, completed: LAB_TIME + 36_000 },
    },
  ],
  status: { type: "idle" },
  diffs: [],
} satisfies SessionDocument

export const ProviderErrors = {
  render: (args: { width: number }) => (
    <CurrentSessionTimelineLab
      title="Provider errors"
      description="Short and wrapped provider errors in the production timeline."
      document={document}
      width={`${args.width}px`}
    />
  ),
}

const executionErrorsDocument = {
  sessionID: CURRENT_SESSION_ID,
  messages: [
    {
      id: "msg_lab_exec_user_1",
      type: "user",
      text: "Reply with the single word ok.",
      time: { created: LAB_TIME + 40_000 },
    },
    {
      id: "msg_lab_exec_idle_1",
      type: "idle",
      outcome: "failed",
      error: { type: "provider.no-route", message: "Model unavailable: opencode/gpt-5.2" },
      time: { created: LAB_TIME + 40_500 },
    },
    {
      id: "msg_lab_exec_user_2",
      type: "user",
      text: "Check the changed files and run lint.",
      time: { created: LAB_TIME + 42_000 },
    },
    ...thinkingDocument.messages.slice(1),
    {
      id: "msg_lab_exec_idle_2",
      type: "idle",
      outcome: "failed",
      error: { type: "unknown", message: "Failed to execute statement" },
      time: { created: LAB_TIME + 45_000 },
    },
  ],
  status: { type: "idle" },
  diffs: [],
} satisfies SessionDocument

export const ExecutionErrors = {
  render: (args: { width: number }) => (
    <CurrentSessionTimelineLab
      title="Execution errors"
      description="Pre-step and between-step session execution failures surfaced from the idle marker."
      document={executionErrorsDocument}
      width={`${args.width}px`}
    />
  ),
}

const linkDocument = {
  sessionID: CURRENT_SESSION_ID,
  messages: [
    ...thinkingDocument.messages,
    {
      id: "msg_lab_error_link",
      type: "assistant",
      agent: "build",
      model: LAB_MODEL,
      content: [],
      error: {
        type: "provider.transport",
        message: "Could not connect to http://localhost:11434/api. Check that Ollama is running.",
      },
      time: { created: LAB_TIME + 33_000, completed: LAB_TIME + 34_000 },
    },
  ],
  status: { type: "idle" },
  diffs: [],
} satisfies SessionDocument

export const LinkedError = {
  render: (args: { width: number }) => (
    <CurrentSessionTimelineLab
      title="Linked error"
      description="A provider error whose message includes a URL."
      document={linkDocument}
      width={`${args.width}px`}
    />
  ),
}
