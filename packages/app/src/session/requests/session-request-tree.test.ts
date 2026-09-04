import { describe, expect, test } from "bun:test"
import type { FormInfo, PermissionRequest, SessionInfo } from "@opencode-ai/client/promise"
import { sessionPermissionRequest, sessionFormRequest, sessionTreeIDs } from "@/session/requests/session-request-tree"

const session = (input: { id: string; parentID?: string }) =>
  ({
    id: input.id,
    parentID: input.parentID,
  }) as SessionInfo

const permission = (id: string, sessionID: string) =>
  ({
    id,
    sessionID,
  }) as PermissionRequest

const question = (id: string, sessionID: string) =>
  ({
    id,
    sessionID,
    title: "Questions",
    metadata: { kind: "question" },
    fields: [{ key: "q0", type: "string" }],
  }) as FormInfo

describe("sessionTreeIDs", () => {
  test("returns only the current session and its descendants", () => {
    const sessions = [
      session({ id: "root" }),
      session({ id: "child", parentID: "root" }),
      session({ id: "grand", parentID: "child" }),
      session({ id: "sibling", parentID: "root" }),
      session({ id: "other" }),
    ]

    expect(sessionTreeIDs(sessions, "child")).toEqual(["child", "grand"])
    expect(sessionTreeIDs(sessions, "root")).toEqual(["root", "child", "sibling", "grand"])
    expect(sessionTreeIDs(sessions)).toEqual([])
  })
})

describe("sessionPermissionRequest", () => {
  test("prefers the current session permission", () => {
    const sessions = [session({ id: "root" }), session({ id: "child", parentID: "root" })]
    const permissions = {
      root: [permission("perm-root", "root")],
      child: [permission("perm-child", "child")],
    }

    expect(sessionPermissionRequest(sessions, permissions, "root")?.id).toBe("perm-root")
  })

  test("returns a nested child permission", () => {
    const sessions = [
      session({ id: "root" }),
      session({ id: "child", parentID: "root" }),
      session({ id: "grand", parentID: "child" }),
      session({ id: "other" }),
    ]
    const permissions = {
      grand: [permission("perm-grand", "grand")],
      other: [permission("perm-other", "other")],
    }

    expect(sessionPermissionRequest(sessions, permissions, "root")?.id).toBe("perm-grand")
  })

  test("returns undefined without a matching tree permission", () => {
    const sessions = [session({ id: "root" }), session({ id: "child", parentID: "root" })]
    const permissions = {
      other: [permission("perm-other", "other")],
    }

    expect(sessionPermissionRequest(sessions, permissions, "root")).toBeUndefined()
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

describe("sessionFormRequest", () => {
  test("prefers the current session question", () => {
    const sessions = [session({ id: "root" }), session({ id: "child", parentID: "root" })]
    const questions = {
      root: [question("q-root", "root")],
      child: [question("q-child", "child")],
    }

    expect(sessionFormRequest(sessions, questions, "root")?.id).toBe("q-root")
  })

  test("returns a nested child question", () => {
    const sessions = [
      session({ id: "root" }),
      session({ id: "child", parentID: "root" }),
      session({ id: "grand", parentID: "child" }),
    ]
    const questions = {
      grand: [question("q-grand", "grand")],
    }

    expect(sessionFormRequest(sessions, questions, "root")?.id).toBe("q-grand")
  })

  test("skips unsupported forms", () => {
    const sessions = [session({ id: "root" })]
    const forms = {
      root: [{ ...question("form", "root"), metadata: { kind: "integration" } }],
    }

    expect(sessionFormRequest(sessions, forms, "root")).toBeUndefined()
  })

  test("finds web search consent in a nested child session", () => {
    const sessions = [session({ id: "root" }), session({ id: "child", parentID: "root" })]
    const form = { ...question("search", "child"), metadata: { kind: "websearch.provider" } }
    expect(sessionFormRequest(sessions, { child: [form] }, "root")).toBe(form)
  })

  test("preserves request order across questions and web search", () => {
    const sessions = [session({ id: "root" }), session({ id: "child", parentID: "root" })]
    const form = { ...question("search", "root"), metadata: { kind: "websearch.provider" } }
    expect(sessionFormRequest(sessions, { root: [form, question("q", "root")] }, "root")).toBe(form)
    expect(sessionFormRequest(sessions, { root: [question("q", "root"), form] }, "root")?.id).toBe("q")
    expect(sessionFormRequest(sessions, { root: [form], child: [question("q", "child")] }, "root")).toBe(form)
  })
})
