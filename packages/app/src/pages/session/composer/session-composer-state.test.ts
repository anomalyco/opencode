import { describe, expect, test } from "bun:test"
import type { Message, Part, PermissionRequest, QuestionRequest, Session } from "@opencode-ai/sdk/v2"
import { resolveQuestionKind, resolveSessionMode } from "./session-mode"
import { sessionPermissionRequest } from "./session-request-tree"

const session = (input: { id: string; parentID?: string }) =>
  ({
    id: input.id,
    parentID: input.parentID,
  }) as Session

const permission = (id: string, sessionID: string) =>
  ({
    id,
    sessionID,
  }) as PermissionRequest

describe("resolveSessionMode", () => {
  test("defaults to build without messages", () => {
    expect(resolveSessionMode(undefined)).toBe("build")
  })

  test("uses latest user agent mode", () => {
    const messages = [
      { role: "user", agent: "build" },
      { role: "assistant" },
      { role: "user", agent: "plan" },
    ] as Message[]
    expect(resolveSessionMode(messages)).toBe("plan")
  })

  test("ignores non-build non-plan user agents", () => {
    const messages = [{ role: "user", agent: "custom" }, { role: "assistant" }] as Message[]
    expect(resolveSessionMode(messages)).toBe("build")
  })

  test("skips filtered permissions in the current tree", () => {
    const sessions = [session({ id: "root" }), session({ id: "child", parentID: "root" })]
    const permissions = {
      root: [permission("perm-root", "root")],
      child: [permission("perm-child", "child")],
    }

    expect(sessionPermissionRequest(sessions, permissions, "root", (item) => item.id !== "perm-root"))?.toMatchObject({
      id: "perm-child",
    })
  })

  test("returns undefined when all tree permissions are filtered out", () => {
    const sessions = [session({ id: "root" }), session({ id: "child", parentID: "root" })]
    const permissions = {
      root: [permission("perm-root", "root")],
      child: [permission("perm-child", "child")],
    }

    expect(sessionPermissionRequest(sessions, permissions, "root", () => false)).toBeUndefined()
  })
})

describe("resolveQuestionKind", () => {
  const request = {
    id: "req_1",
    sessionID: "ses_1",
    questions: [],
    tool: {
      messageID: "msg_1",
      callID: "call_1",
    },
  } as QuestionRequest

  test("returns generic when question has no tool ref", () => {
    expect(resolveQuestionKind({ request: { ...request, tool: undefined }, parts: [] })).toBe("generic")
  })

  test("detects plan_enter from matching tool part", () => {
    const parts = [{ type: "tool", callID: "call_1", tool: "plan_enter" }] as Part[]
    expect(resolveQuestionKind({ request, parts })).toBe("plan_enter")
  })

  test("detects plan_exit from matching tool part", () => {
    const parts = [{ type: "tool", callID: "call_1", tool: "plan_exit" }] as Part[]
    expect(resolveQuestionKind({ request, parts })).toBe("plan_exit")
  })

  test("returns generic on missing or mismatched part", () => {
    const parts = [{ type: "tool", callID: "call_2", tool: "plan_exit" }] as Part[]
    expect(resolveQuestionKind({ request, parts })).toBe("generic")
  })
})
