import { describe, test, expect } from "bun:test"
import {
  MessageType,
  type MessageEnvelope,
  type MessagePayload,
  type TaskPayload,
  type TaskResultPayload,
  type TaskProgressPayload,
  type DelegatePayload,
  type HandoffPayload,
  type ShareRequestPayload,
  type ShareResultPayload,
  type ContextRequestPayload,
  type ContextResponsePayload,
  type AgentRegisterPayload,
  type AgentHeartbeatPayload,
  type ErrorPayload,
  type DeadLetterPayload,
  type AgentCapabilities,
  type AgentStatus,
  type Decision,
  type AgentInfo,
  type AgentID,
} from "../../src/protocol/messages.js"

describe("MessageType", () => {
  test("contains all 24 types", () => {
    const types = Object.values(MessageType)
    expect(types.length).toBe(23)
    expect(types).toContain("message")
    expect(types).toContain("task")
    expect(types).toContain("task.result")
    expect(types).toContain("task.progress")
    expect(types).toContain("task.cancel")
    expect(types).toContain("delegate")
    expect(types).toContain("delegate.result")
    expect(types).toContain("handoff")
    expect(types).toContain("handoff.accepted")
    expect(types).toContain("share.request")
    expect(types).toContain("share.result")
    expect(types).toContain("context.request")
    expect(types).toContain("context.response")
    expect(types).toContain("disagreement")
    expect(types).toContain("agent.spawn")
    expect(types).toContain("agent.terminate")
    expect(types).toContain("agent.heartbeat")
    expect(types).toContain("agent.register")
    expect(types).toContain("agent.deregister")
    expect(types).toContain("agent.capability.query")
    expect(types).toContain("agent.list")
    expect(types).toContain("error")
    expect(types).toContain("dead_letter")
  })
})

describe("Payload types", () => {
  test("MessagePayload has content", () => {
    const p: MessagePayload = { content: "hello" }
    expect(p.content).toBe("hello")
  })

  test("TaskPayload has required fields", () => {
    const p: TaskPayload = {
      task_id: "t1",
      title: "Do stuff",
      description: "Do some stuff",
      priority: "high",
    }
    expect(p.task_id).toBe("t1")
    expect(p.title).toBe("Do stuff")
    expect(p.priority).toBe("high")
  })

  test("TaskResultPayload has status enum", () => {
    const statuses: TaskResultPayload["status"][] = ["completed", "failed", "cancelled", "partial"]
    expect(statuses.length).toBe(4)
  })

  test("TaskProgressPayload has status enum", () => {
    const statuses: TaskProgressPayload["status"][] = ["working", "waiting", "blocked"]
    expect(statuses.length).toBe(3)
  })

  test("DelegatePayload has task and return_to", () => {
    const p: DelegatePayload = {
      task: { task_id: "t1", title: "x", description: "y", priority: "normal" },
      max_depth: 2,
      return_to: "agent-a",
    }
    expect(p.max_depth).toBe(2)
    expect(p.return_to).toBe("agent-a")
  })

  test("HandoffPayload has progress with next_steps", () => {
    const p: HandoffPayload = {
      task_id: "t1",
      reason: "done for today",
      progress: {
        description: "partial",
        files_modified: [],
        files_created: [],
        next_steps: ["finish tests"],
        blockers: [],
      },
      transfer_worktree: true,
    }
    expect(p.progress.next_steps).toEqual(["finish tests"])
    expect(p.transfer_worktree).toBe(true)
  })

  test("ShareRequestPayload has files array", () => {
    const p: ShareRequestPayload = {
      branch: "feat",
      description: "share",
      auto_merge: true,
      files: ["src/index.ts"],
    }
    expect(p.files.length).toBe(1)
  })

  test("ShareResultPayload has status enum", () => {
    const statuses: ShareResultPayload["status"][] = ["merged", "conflict", "validation_failed", "rejected"]
    expect(statuses.length).toBe(4)
  })

  test("ContextRequestPayload has scope enum", () => {
    const scopes: ContextRequestPayload["scope"][] = ["team", "agent", "conversation"]
    expect(scopes.length).toBe(3)
  })

  test("ContextResponsePayload requires result string", () => {
    const p: ContextResponsePayload = {
      query: "q",
      result: "answer",
      source: { agent: "a1" },
    }
    expect(p.result).toBe("answer")
  })

  test("AgentRegisterPayload has role", () => {
    const p: AgentRegisterPayload = {
      agent_id: "a1",
      role: "coder",
      role_priority: 10,
      capabilities: {
        tools: ["read"],
        read: true,
        write_own_workspace: true,
        share_to_team: false,
        delegate: true,
        spawn_subagents: false,
        max_delegation_depth: 2,
        disk_quota_mb: 500,
        protected_paths: [],
      },
      max_concurrent_tasks: 1,
      workspace_path: "/tmp/ws",
    }
    expect(p.role).toBe("coder")
  })

  test("AgentHeartbeatPayload has status enum", () => {
    const statuses: AgentHeartbeatPayload["status"][] = ["idle", "busy", "waiting"]
    expect(statuses.length).toBe(3)
  })
})

describe("AgentCapabilities", () => {
  test("has correct defaults", () => {
    const caps: AgentCapabilities = {
      tools: ["read", "glob", "grep", "list"],
      read: true,
      write_own_workspace: true,
      share_to_team: false,
      delegate: true,
      spawn_subagents: false,
      max_delegation_depth: 2,
      disk_quota_mb: 500,
      protected_paths: [],
    }
    expect(caps.tools.length).toBe(4)
    expect(caps.max_delegation_depth).toBe(2)
    expect(caps.disk_quota_mb).toBe(500)
  })
})

describe("AgentStatus", () => {
  test("has 6 states", () => {
    const statuses: AgentStatus[] = ["spawning", "idle", "busy", "waiting", "terminating", "dead"]
    expect(statuses.length).toBe(6)
  })
})

describe("Decision", () => {
  test("has required fields", () => {
    const d: Decision = {
      id: "d1",
      timestamp: Date.now(),
      summary: "chose X",
      rationale: "because Y",
    }
    expect(d.id).toBe("d1")
    expect(d.summary).toBe("chose X")
  })
})

describe("MessageEnvelope", () => {
  test("has required fields after orchestrator inject", () => {
    const env: MessageEnvelope = {
      id: "uuid-1",
      type: "message",
      from: "agent-a",
      to: "agent-b",
      timestamp: Date.now(),
      hop_count: 0,
      idempotency_key: "abc123",
      priority: "normal",
      protocol_version: 1,
      payload: { content: "hello" },
    }
    expect(env.id).toBeTruthy()
    expect(env.from).toBe("agent-a")
    expect(env.timestamp).toBeGreaterThan(0)
  })
})
