import type { OpenCodeEvent, SessionMessageInfo } from "@opencode/client/promise"
import type { Page } from "@playwright/test"
import { mockWorkspace } from "./workspace"
import { session } from "./app"

export const nestedWorkers = {
  root: "ses_workers_root",
  outer: "ses_workers_outer",
  inner: "ses_workers_inner",
}

export async function mockNestedWorkers(page: Page) {
  const messages = (childID?: string): SessionMessageInfo[] => [
    { id: "msg_user", type: "user", text: "Run nested workers", time: { created: 1700000000000 } },
    {
      id: "msg_assistant",
      type: "assistant",
      agent: "build",
      model: { id: "model", providerID: "provider" },
      time: { created: 1700000000001 },
      content: [
        {
          type: "tool",
          id: "call_worker",
          name: childID ? "subagent" : "shell",
          state: {
            status: "running",
            input: childID
              ? { agent: "general", description: childID === nestedWorkers.outer ? "Outer worker" : "Inner worker" }
              : { command: "sleep 120" },
            metadata: childID ? { sessionID: childID } : {},
          },
          time: { created: 1700000000001 },
        },
      ],
    },
  ]

  const workspace = await mockWorkspace(page, {
    name: "NestedWorkers",
    sessions: [
      { id: nestedWorkers.root, title: "Root session" },
      { id: nestedWorkers.outer, title: "Outer worker", parentID: nestedWorkers.root, agent: "general" },
      { id: nestedWorkers.inner, title: "Inner worker", parentID: nestedWorkers.outer, agent: "general" },
      { id: "ses_unrelated_root", title: "Unrelated session" },
      { id: "ses_unrelated_worker", title: "Unrelated worker", parentID: "ses_unrelated_root" },
    ],
    sessionStatus: Object.fromEntries(
      [...Object.values(nestedWorkers), "ses_unrelated_worker"].map((id) => [id, { type: "busy" }]),
    ),
    pageMessages: (id) => ({
      items:
        id === nestedWorkers.root
          ? messages(nestedWorkers.outer)
          : id === nestedWorkers.outer
            ? messages(nestedWorkers.inner)
            : id === nestedWorkers.inner
              ? messages()
              : [],
    }),
    seed: { tabs: [nestedWorkers.root] },
  })

  return {
    ...workspace,
    async finish(sessionID: string, parentID: string) {
      const events: OpenCodeEvent[] = [
        {
          id: `evt_${sessionID}_finished`,
          type: "session.execution.succeeded",
          created: 1700000001000,
          durable: { aggregateID: sessionID, seq: 1, version: 1 },
          location: { directory: workspace.directory },
          data: { sessionID },
        },
        {
          id: `evt_${parentID}_tool_finished`,
          type: "session.tool.success",
          created: 1700000001001,
          durable: { aggregateID: parentID, seq: 1, version: 2 },
          location: { directory: workspace.directory },
          data: {
            sessionID: parentID,
            assistantMessageID: "msg_assistant",
            id: "call_worker",
            content: [{ type: "text", text: "Worker finished" }],
            metadata: {},
            executed: true,
          },
        },
      ]

      await workspace.push(events)
    },
  }
}

// Repeated descriptions do not identify a session while a new tool call is starting.
export async function mockStartingWorkers(page: Page) {
  const messages: SessionMessageInfo[] = [
    { id: "msg_user", type: "user", text: "Inspect twice", time: { created: 1700000000000 } },
    {
      id: "msg_assistant",
      type: "assistant",
      agent: "build",
      model: { id: "model", providerID: "provider" },
      time: { created: 1700000000001 },
      content: ["call_first", "call_second"].map((id) => ({
        type: "tool",
        id,
        name: "subagent",
        state: { status: "running", input: { agent: "general", description: "Inspect code" }, metadata: {} },
        time: { created: 1700000000001 },
      })),
    },
  ]

  const workspace = await mockWorkspace(page, {
    name: "StartingWorkers",
    sessions: [
      { id: nestedWorkers.root, title: "Root session" },
      { id: "ses_old_worker", title: "Inspect code", parentID: nestedWorkers.root, agent: "general" },
    ],
    sessionStatus: { [nestedWorkers.root]: { type: "busy" } },
    pageMessages: (id) => ({ items: id === nestedWorkers.root ? messages : [] }),
    seed: { tabs: [nestedWorkers.root] },
  })

  return {
    ...workspace,
    old: "ses_old_worker",
    first: "ses_starting_first",
    second: "ses_starting_second",
    async start(sessionID: string, partID?: string) {
      workspace.sessions.push(
        session({
          id: sessionID,
          directory: workspace.directory,
          projectID: workspace.projectID,
          parentID: nestedWorkers.root,
          agent: "general",
          title: "Inspect code",
          created: 1700000001000,
        }),
      )

      const events: OpenCodeEvent[] = [
        {
          id: `evt_${sessionID}_started`,
          type: "session.execution.started",
          created: 1700000001000,
          durable: { aggregateID: sessionID, seq: 1, version: 1 },
          location: { directory: workspace.directory },
          data: { sessionID },
        },
      ]

      if (partID)
        events.push({
          id: `evt_${sessionID}_linked`,
          type: "session.tool.progress",
          created: 1700000001001,
          location: { directory: workspace.directory },
          data: {
            sessionID: nestedWorkers.root,
            assistantMessageID: "msg_assistant",
            id: partID,
            metadata: { sessionID, status: "running" },
          },
        })

      await workspace.push(events)
    },
    async interrupted(sessionID: string) {
      await workspace.push([
        {
          id: `evt_${sessionID}_interrupted`,
          type: "session.execution.interrupted",
          created: 1700000002000,
          durable: { aggregateID: sessionID, seq: 2, version: 1 },
          location: { directory: workspace.directory },
          data: { sessionID, reason: "user" },
        },
      ])
    },
  }
}
