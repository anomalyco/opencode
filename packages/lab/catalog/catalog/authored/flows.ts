import { defineFlows } from "../dsl"
import { executableFlowDefinitions } from "../../scenarios"
import { screens } from "./screens"

export const flowGroups = defineFlows(screens, {
  "getting-started": {
    label: "Getting started",
    flows: {
      "starting-a-session": {
        title: "Starting a session",
        description: "Begin from the OpenCode start screen and prepare a new conversation.",
        steps: [
          { capture: "home", title: "Start a new conversation", trigger: "Open OpenCode" },
          { capture: "model-picker", title: "Choose a model", trigger: "Open the model picker" },
          { capture: "agent-picker", title: "Choose an agent", trigger: "Open the agent picker" },
        ],
      },
    },
  },
  "session-management": {
    label: "Session management",
    flows: {
      ...executableFlowDefinitions("session-management"),
      "switching-sessions": {
        title: "Switching sessions",
        description: "Find an existing conversation and resume it from the session picker.",
        steps: [
          { capture: "command-palette", title: "Open session navigation", trigger: "Open the command palette" },
          { capture: "session-picker", title: "Open the session picker", trigger: "Run Switch session" },
          { capture: "session-picker-populated", title: "Select a session", trigger: "Search, then press Enter" },
        ],
      },
      "renaming-a-session": {
        title: "Renaming a session",
        description: "Give the current conversation a recognizable name.",
        steps: [
          { capture: "session-picker-populated", title: "Identify the current session" },
          { capture: "session-rename", title: "Enter the new name", trigger: "Run /rename" },
        ],
      },
      "forking-a-session": {
        title: "Forking a session",
        description: "Branch an existing conversation from a selected message.",
        steps: [
          { capture: "session-picker-populated", title: "Open the source session" },
          { capture: "session-fork", title: "Choose the fork point", trigger: "Run /fork" },
        ],
      },
      "exporting-a-session": {
        title: "Exporting a session",
        description: "Choose an export format and confirm the transcript was copied.",
        steps: [
          { capture: "session-export", title: "Choose an export format", trigger: "Run /export" },
          { capture: "toast-success", title: "Confirm the export", trigger: "Complete the export action" },
        ],
      },
    },
  },
  "tool-use": {
    label: "Tool use",
    flows: {
      ...executableFlowDefinitions("tool-use"),
      "answering-a-question": {
        title: "Answering an agent question",
        description: "Respond to a structured question without leaving the conversation.",
        steps: [
          { capture: "question-prompt", title: "Choose or enter an answer", trigger: "Submit the question form" },
        ],
      },
    },
  },
  subagents: {
    label: "Subagents",
    flows: executableFlowDefinitions("subagents"),
  },
  responses: {
    label: "Responses",
    flows: executableFlowDefinitions("responses"),
  },
  configuration: {
    label: "Configuration",
    flows: {
      "connecting-an-integration": {
        title: "Connecting an integration",
        description: "Choose an integration and verify its connection state.",
        steps: [
          { capture: "integration-picker", title: "Choose an integration" },
          { capture: "status", title: "Check the connection status" },
        ],
      },
      "managing-mcp-servers": {
        title: "Managing MCP servers",
        description: "Inspect configured MCP servers and their runtime status.",
        steps: [
          { capture: "mcp-list", title: "Open MCP management" },
          { capture: "status", title: "Inspect MCP status" },
        ],
      },
      "pairing-a-device": {
        title: "Pairing a device",
        description: "Open the pairing code used to connect another device.",
        steps: [{ capture: "pair", title: "Scan the pairing code" }],
      },
    },
  },
  review: {
    label: "Review",
    flows: {
      "reviewing-a-diff": {
        title: "Reviewing a diff",
        description: "Inspect the working tree and verify whether files have changed.",
        steps: [{ capture: "diff-viewer", title: "Open the diff viewer", trigger: "Run /diff" }],
      },
    },
  },
})
