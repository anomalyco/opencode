import { describe, expect, test } from "bun:test"
import {
  answerWorkflowRun,
  asWorkflowRunEvent,
  decodeWorkflowApiThrow,
  questionOptions,
  saveWorkflowPayload,
  saveWorkflowRun,
  selectedAnswer,
  workflowFinishedNotice,
} from "./dialog-workflow-client"

// The wire shapes the httpapi serializes for workflow errors (errors.ts +
// groups/workflow.ts) — with throwOnError:true the hey-api transport throws
// exactly these parsed bodies as plain objects.
const notFoundBody = { name: "NotFoundError", data: { message: "run not found" } }
const conflictBody = { _tag: "ConflictError", message: "workflow exists", resource: "n" }
const invalidBody = { _tag: "WorkflowApiError", message: "meta: name must be kebab-case" }

const fake = (data: unknown, status: number) =>
  ({
    client: { workflow: { answer: async () => ({ data, response: { status } }) } },
    directory: "/x",
  }) as any

describe("answerWorkflowRun status mapping", () => {
  test("maps 404 → not_found", async () => {
    expect(await answerWorkflowRun(fake(undefined, 404), { id: "r", answer: "y" })).toEqual({ type: "not_found" })
  })
  test("maps 409 → no_question", async () => {
    expect((await answerWorkflowRun(fake(undefined, 409), { id: "r", answer: "y" })).type).toBe("no_question")
  })
  test("maps 200 → ok with run", async () => {
    const run = { id: "r", workflow: "w", status: "running" as const, logs: [], agents: [], started_at: 0 }
    expect(await answerWorkflowRun(fake(run, 200), { id: "r", answer: "y" })).toEqual({ type: "ok", run })
  })
  test("maps an unexpected status → error", async () => {
    expect((await answerWorkflowRun(fake(undefined, 500), { id: "r", answer: "y" })).type).toBe("error")
  })
  test("a thrown transport failure → error", async () => {
    const throwing = {
      client: {
        workflow: {
          answer: async () => {
            throw new Error("boom")
          },
        },
      },
      directory: "/x",
    } as any
    const result = await answerWorkflowRun(throwing, { id: "r", answer: "y" })
    expect(result).toEqual({ type: "error", message: "boom" })
  })
})

describe("decodeWorkflowApiThrow", () => {
  test("decodes a thrown NotFoundError body → 404 + message", () => {
    expect(decodeWorkflowApiThrow(notFoundBody)).toEqual({ status: 404, message: "run not found" })
  })
  test("decodes a thrown ConflictError body → 409 + message", () => {
    expect(decodeWorkflowApiThrow(conflictBody)).toEqual({ status: 409, message: "workflow exists" })
  })
  test("decodes a thrown WorkflowApiError body → 400 + message", () => {
    expect(decodeWorkflowApiThrow(invalidBody)).toEqual({ status: 400, message: "meta: name must be kebab-case" })
  })
  test("keeps the message of an Error instance (no status)", () => {
    expect(decodeWorkflowApiThrow(new TypeError("fetch failed"))).toEqual({ message: "fetch failed" })
  })
  test("keeps a thrown string as the message", () => {
    expect(decodeWorkflowApiThrow("plain text body")).toEqual({ message: "plain text body" })
  })
  test("an untagged plain object decodes to {} — never '[object Object]'", () => {
    expect(decodeWorkflowApiThrow({ some: "thing" })).toEqual({})
    expect(decodeWorkflowApiThrow({})).toEqual({})
  })
})

// The app default: clients are created with throwOnError:true, so non-2xx
// responses arrive as THROWN parsed bodies, never as result.response.status.
describe("answerWorkflowRun throwing client", () => {
  const throwing = (body: unknown) =>
    ({
      client: {
        workflow: {
          answer: async () => {
            throw body
          },
        },
      },
      directory: "/x",
    }) as any

  test("a thrown NotFoundError body → not_found", async () => {
    expect(await answerWorkflowRun(throwing(notFoundBody), { id: "r", answer: "y" })).toEqual({ type: "not_found" })
  })
  test("a thrown ConflictError body → no_question", async () => {
    expect(await answerWorkflowRun(throwing(conflictBody), { id: "r", answer: "y" })).toEqual({ type: "no_question" })
  })
  test("a thrown TypeError (network failure) → error with its message", async () => {
    const result = await answerWorkflowRun(throwing(new TypeError("fetch failed")), { id: "r", answer: "y" })
    expect(result).toEqual({ type: "error", message: "fetch failed" })
  })
  test("a thrown empty body falls back to 'request failed' — never '[object Object]'", async () => {
    const result = await answerWorkflowRun(throwing({}), { id: "r", answer: "y" })
    expect(result.type).toBe("error")
    if (result.type === "error") {
      expect(result.message).toBe("request failed")
      expect(result.message).not.toBe("[object Object]")
    }
  })
})

describe("asWorkflowRunEvent narrowing", () => {
  test("narrows workflow.run.finished and updated", () => {
    expect(asWorkflowRunEvent({ type: "workflow.run.finished", id: "e", properties: { id: "r" } } as any)?.kind).toBe(
      "finished",
    )
    expect(asWorkflowRunEvent({ type: "workflow.run.updated", id: "e", properties: { id: "r" } } as any)?.kind).toBe(
      "updated",
    )
  })
  test("returns undefined for an unrelated event", () => {
    expect(asWorkflowRunEvent({ type: "session.status" } as any)).toBeUndefined()
  })
})

describe("saveWorkflowPayload", () => {
  test("omits scope when unset so the server default (project) applies", () => {
    expect(saveWorkflowPayload({ name: "n", source: "s" })).toEqual({ name: "n", source: "s" })
  })
  test("includes scope when explicitly project/global", () => {
    expect(saveWorkflowPayload({ name: "n", source: "s", scope: "global" })).toEqual({
      name: "n",
      source: "s",
      scope: "global",
    })
    expect(saveWorkflowPayload({ name: "n", source: "s", scope: "project" }).scope).toBe("project")
  })
})

describe("saveWorkflowRun status mapping", () => {
  // The generated `workflow.save` — the mock client deliberately carries NO
  // `.post`: the raw-transport fallback is gone, only save() is called.
  const fakeSave = (data: unknown, status: number) =>
    ({
      client: { workflow: { save: async () => ({ data, response: { status } }) } },
      directory: "/x",
    }) as any

  test("maps 200 + path → ok", async () => {
    expect(
      await saveWorkflowRun(fakeSave({ path: "/p/.opencode/workflows/n.ts" }, 200), { name: "n", source: "s" }),
    ).toEqual({
      type: "ok",
      path: "/p/.opencode/workflows/n.ts",
    })
  })
  test("maps 409 → conflict", async () => {
    expect((await saveWorkflowRun(fakeSave(undefined, 409), { name: "n", source: "s" })).type).toBe("conflict")
  })
  test("maps 400 → invalid", async () => {
    expect((await saveWorkflowRun(fakeSave(undefined, 400), { name: "n", source: "s" })).type).toBe("invalid")
  })
  test("maps an unexpected status → error", async () => {
    expect((await saveWorkflowRun(fakeSave(undefined, 500), { name: "n", source: "s" })).type).toBe("error")
  })

  // The app default: throwOnError:true clients throw the parsed error body.
  const throwingSave = (body: unknown) =>
    ({
      client: {
        workflow: {
          save: async () => {
            throw body
          },
        },
      },
      directory: "/x",
    }) as any

  test("a thrown ConflictError body → conflict", async () => {
    expect(await saveWorkflowRun(throwingSave(conflictBody), { name: "n", source: "s" })).toEqual({ type: "conflict" })
  })
  test("a thrown WorkflowApiError body → invalid with the real server message", async () => {
    const result = await saveWorkflowRun(throwingSave(invalidBody), { name: "n", source: "s" })
    expect(result).toEqual({ type: "invalid", message: "meta: name must be kebab-case" })
  })
  test("a thrown transport failure → error with its message — never '[object Object]'", async () => {
    const result = await saveWorkflowRun(throwingSave(new Error("boom")), { name: "n", source: "s" })
    expect(result).toEqual({ type: "error", message: "boom" })
    expect(await saveWorkflowRun(throwingSave({}), { name: "n", source: "s" })).toEqual({
      type: "error",
      message: "request failed",
    })
  })
})

describe("workflowFinishedNotice", () => {
  test("completed → success with no detail", () => {
    expect(workflowFinishedNotice({ workflow: "review", status: "completed" })).toEqual({
      done: true,
      variant: "success",
    })
  })
  test("failed → error with the run error as detail", () => {
    expect(workflowFinishedNotice({ workflow: "review", status: "failed", error: "agent build exploded" })).toEqual({
      done: false,
      variant: "error",
      detail: "agent build exploded",
    })
  })
  test("failed without an error message falls back to the status text", () => {
    expect(workflowFinishedNotice({ workflow: "review", status: "failed", error: "" }).detail).toBe("failed")
  })
  test("cancelled → error variant with the status as detail (TUI parity)", () => {
    expect(workflowFinishedNotice({ workflow: "review", status: "cancelled" })).toEqual({
      done: false,
      variant: "error",
      detail: "cancelled",
    })
  })
})

describe("questionOptions + selectedAnswer", () => {
  test("appends a free-text sentinel after declared options", () => {
    const out = questionOptions({ question: "q", options: ["a", "b"], asked_at: 1 })
    expect(out.map((o) => o.kind)).toEqual(["option", "option", "freetext"])
  })
  test("selectedAnswer returns the option label or the trimmed free text", () => {
    const opts = questionOptions({ question: "q", options: ["yes"], asked_at: 1 })
    expect(selectedAnswer(opts, 0, "ignored")).toBe("yes")
    expect(selectedAnswer(opts, 1, "  custom  ")).toBe("custom")
    expect(selectedAnswer(opts, 1, "   ")).toBeUndefined()
    expect(selectedAnswer(opts, 9, "x")).toBeUndefined()
  })
})
