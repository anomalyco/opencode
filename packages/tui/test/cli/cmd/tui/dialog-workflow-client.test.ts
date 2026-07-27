import { describe, expect, test } from "bun:test"
import type { Event, WorkflowRun } from "@opencode-ai/sdk/v2"
import {
  answerWorkflowRun,
  asWorkflowRunEvent,
  type AnswerInput,
  type WorkflowAnswerClient,
  type WorkflowRunEvent,
} from "../../../../src/component/dialog-workflow-client"

// Builds a real workflow.run.* Event union member (the generated SDK now carries
// these), so the narrower is exercised against the genuine typed shape — no cast.
function runEvent(
  type: "workflow.run.updated" | "workflow.run.finished",
  properties: Partial<Extract<Event, { type: "workflow.run.updated" }>["properties"]>,
): Event {
  return {
    id: `evt_${type}`,
    type,
    properties: {
      id: "job_x",
      workflow: "demo",
      status: "running",
      current_phase: "",
      directory: "/ws",
      agents: { total: 0, running: 0, failed: 0 },
      pending_question: false,
      error: "",
      ...properties,
    },
  } as Event
}

describe("asWorkflowRunEvent", () => {
  test("narrows a workflow.run.finished Event union member to a typed run event", () => {
    const narrowed = asWorkflowRunEvent(runEvent("workflow.run.finished", { id: "job_x", status: "completed" }))
    expect(narrowed).toBeDefined()
    expect(narrowed!.kind).toBe("finished")
    expect(narrowed!.run.id).toBe("job_x")
    expect(narrowed!.run.status).toBe("completed")
    expect(narrowed!.run.pending_question).toBe(false)
  })

  test("recognizes updated events and exposes pending_question true", () => {
    const narrowed = asWorkflowRunEvent(runEvent("workflow.run.updated", { id: "job_q", pending_question: true }))
    expect(narrowed!.kind).toBe("updated")
    expect(narrowed!.run.pending_question).toBe(true)
  })

  test("returns undefined for unrelated events", () => {
    const raw: Event = { id: "e", type: "vcs.branch.updated", properties: { branch: "main" } }
    expect(asWorkflowRunEvent(raw)).toBeUndefined()
  })
})

describe("answerWorkflowRun", () => {
  // Fakes the generated client's `workflow.answer` method: records the call args
  // and returns the SDK's `{ data, error, response }` fields shape.
  function fakeSdk(status: number, run?: WorkflowRun) {
    const calls: { id: string; directory?: string; body: AnswerInput["answer"] | undefined; permission?: string }[] = []
    const sdk: WorkflowAnswerClient = {
      directory: "/ws",
      client: {
        workflow: {
          answer: async (parameters: { id: string; directory?: string; workflowAnswerPayload?: unknown }) => {
            const payload = parameters.workflowAnswerPayload as
              | { answer: string; permissionSessionID?: string }
              | undefined
            calls.push({
              id: parameters.id,
              directory: parameters.directory,
              body: payload?.answer,
              permission: payload?.permissionSessionID,
            })
            return {
              data: status === 200 ? (run as WorkflowRun) : undefined,
              error: status === 200 ? undefined : ({} as never),
              request: new Request("http://test"),
              response: new Response(null, { status }),
            }
          },
        },
        // Only `workflow.answer` is exercised; the rest of the generated client is
        // unused by this helper.
      } as unknown as WorkflowAnswerClient["client"],
    }
    return { sdk, calls }
  }

  test("returns {run} on 200 and forwards id/directory/body", async () => {
    const run: WorkflowRun = { id: "job_x", workflow: "demo", status: "running", started_at: 1, logs: [], agents: [] }
    const { sdk, calls } = fakeSdk(200, run)
    const result = await answerWorkflowRun(sdk, { id: "job_x", answer: "yes", permissionSessionID: "ses_1" })
    expect(result.type).toBe("ok")
    expect(result.type === "ok" && result.run.id).toBe("job_x")
    expect(calls[0]).toEqual({ id: "job_x", directory: "/ws", body: "yes", permission: "ses_1" })
  })

  test("omits permissionSessionID from the payload when not provided", async () => {
    const run: WorkflowRun = { id: "job_x", workflow: "demo", status: "running", started_at: 1, logs: [], agents: [] }
    const { sdk, calls } = fakeSdk(200, run)
    await answerWorkflowRun(sdk, { id: "job_x", answer: "y" })
    expect(calls[0].permission).toBeUndefined()
  })

  test("maps 404 to not_found and 409 to no_question", async () => {
    expect((await answerWorkflowRun(fakeSdk(404).sdk, { id: "job_x", answer: "y" })).type).toBe("not_found")
    expect((await answerWorkflowRun(fakeSdk(409).sdk, { id: "job_x", answer: "y" })).type).toBe("no_question")
  })

  test("maps any other status to error", async () => {
    expect((await answerWorkflowRun(fakeSdk(500).sdk, { id: "job_x", answer: "y" })).type).toBe("error")
  })
})

describe("WorkflowRunEvent type", () => {
  test("kind union is updated|finished and run is the generated event properties", () => {
    const e: WorkflowRunEvent = {
      kind: "updated",
      run: {
        id: "x",
        workflow: "demo",
        status: "running",
        current_phase: "",
        directory: "/ws",
        agents: { total: 0, running: 0, failed: 0 },
        pending_question: false,
        error: "",
      },
    }
    expect(e.kind).toBe("updated")
  })
})

describe("WorkflowRun.pending_question", () => {
  test("the generated WorkflowRun carries an optional pending_question (compile-time check)", () => {
    const run: WorkflowRun = {
      id: "job_x",
      workflow: "demo",
      status: "paused",
      started_at: 1,
      logs: [],
      agents: [],
      pending_question: { question: "q?", options: ["a"], asked_at: 1 },
    }
    expect(run.pending_question?.question).toBe("q?")
  })
})
