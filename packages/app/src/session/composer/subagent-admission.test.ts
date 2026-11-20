import { describe, expect, test } from "bun:test"
import type { PromptSession } from "@/composer/admission"
import { sendSubagentMessage } from "./subagent-admission"

type PromptInput = Parameters<PromptSession["data"]["session"]["prompt"]>[0]

type Status = "idle" | "running"

let sessions = 0

const info = {
  id: "ses_child",
  projectID: "proj",
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  agent: "explore",
  model: { id: "claude-opus-4-6", providerID: "opencode", variant: "high" },
  time: { created: 0, updated: 0 },
  location: { directory: "C:/repo" },
}

function child(input: { failures?: number; admitted?: boolean; status?: Status; attributed?: boolean } = {}) {
  const sessionID = `ses_child_${++sessions}`
  const prompts: PromptInput[] = []
  const statuses: ("idle" | "running")[] = []
  const accepted: string[] = []
  const failures = input.failures ?? 0
  const { agent, model, ...unattributed } = info

  const session = {
    get: () => (input.attributed === false ? unattributed : info),
    status: () => input.status ?? "running",
    input: { has: (_sessionID: string, _messageID: string) => input.admitted ?? false },
    message: { get: (_sessionID: string, _messageID: string) => undefined },
    prompt: async (value: PromptInput) => {
      prompts.push(value)

      if (prompts.length <= failures) throw new Error("offline")

      return {
        id: value.id ?? "msg_admitted",
        sessionID: value.sessionID,
        time: { created: 0 },
        type: "user" as const,
        delivery: value.delivery ?? "steer",
        payload: { text: value.text },
      }
    },
    setStatus: (_sessionID: string, status: "idle" | "running") => void statuses.push(status),
    acceptSend: (id: string) => void accepted.push(id),
    sequence: async <Value>(_sessionID: string, send: () => Promise<Value>, prepare?: () => Promise<unknown>) => {
      await prepare?.()

      return send()
    },
  }

  return { data: { session }, sessionID, prompts, statuses, accepted }
}

describe("subagent message", () => {
  test("steers the child's own Session with its attribution", async () => {
    const { data, sessionID, prompts } = child()

    await sendSubagentMessage({ data, sessionID, id: "msg_out", text: "Check the failing test" })

    expect(prompts[0]).toMatchObject({
      id: "msg_out",
      sessionID,
      delivery: "steer",
      text: "Check the failing test",
      metadata: {
        displayText: "Check the failing test",
        agent: "explore",
        model: { providerID: "opencode", modelID: "claude-opus-4-6", variant: "high" },
      },
    })
  })

  test("omits attribution the Session has not recorded", async () => {
    const { data, sessionID, prompts } = child({ attributed: false })

    await sendSubagentMessage({ data, sessionID, id: "msg_out", text: "Hi" })

    expect(prompts[0]?.metadata).toEqual({ displayText: "Hi" })
  })

  test("marks an idle child running until its admission settles", async () => {
    const running = child({ status: "running" })
    const idle = child({ status: "idle" })

    await sendSubagentMessage({ data: running.data, sessionID: running.sessionID, id: "msg_out", text: "Hi" })
    await sendSubagentMessage({ data: idle.data, sessionID: idle.sessionID, id: "msg_out", text: "Hi" })

    expect(running.statuses).toEqual([])
    expect(idle.statuses).toEqual(["running"])
  })

  test("retries a lost response under the same admission ID", async () => {
    const { data, sessionID, prompts, accepted } = child({ failures: 1 })

    await sendSubagentMessage({ data, sessionID, id: "msg_out", text: "Hi" })

    expect(prompts.map((prompt) => prompt.id)).toEqual(["msg_out", "msg_out"])
    expect(accepted).toEqual([sessionID])
  })

  test("reports a send that fails twice and does not floor the Session", async () => {
    const { data, sessionID, accepted, statuses } = child({ failures: 2, status: "idle" })

    await expect(sendSubagentMessage({ data, sessionID, id: "msg_out", text: "Hi" })).rejects.toThrow("offline")

    expect(accepted).toEqual([])
    expect(statuses).toEqual(["running", "idle"])
  })

  test("counts a failure whose row was already admitted as sent", async () => {
    const { data, sessionID, accepted } = child({ failures: 2, admitted: true })

    await sendSubagentMessage({ data, sessionID, id: "msg_out", text: "Hi" })

    expect(accepted).toEqual([sessionID])
  })
})
