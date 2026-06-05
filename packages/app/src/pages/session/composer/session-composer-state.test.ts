import { describe, expect, mock, test } from "bun:test"
import type { PermissionRequest, QuestionRequest, Session } from "@opencode-ai/sdk/v2/client"
import { sessionPermissionRequest, sessionQuestionRequest } from "./session-request-tree"

mock.module("@solidjs/router", () => ({ useParams: () => ({ id: "root" }) }))

const { isStalePermissionResponseFailure, removePermissionRequest, todoState } = await import("./session-composer-state")

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

const question = (id: string, sessionID: string) =>
  ({
    id,
    sessionID,
    questions: [],
  }) as QuestionRequest

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

describe("sessionQuestionRequest", () => {
  test("prefers the current session question", () => {
    const sessions = [session({ id: "root" }), session({ id: "child", parentID: "root" })]
    const questions = {
      root: [question("q-root", "root")],
      child: [question("q-child", "child")],
    }

    expect(sessionQuestionRequest(sessions, questions, "root")?.id).toBe("q-root")
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

    expect(sessionQuestionRequest(sessions, questions, "root")?.id).toBe("q-grand")
  })
})

describe("todoState", () => {
  test("hides when there are no todos", () => {
    expect(todoState({ count: 0, done: false, live: true })).toBe("hide")
  })

  test("opens while the session is still working", () => {
    expect(todoState({ count: 2, done: false, live: true })).toBe("open")
  })

  test("closes completed todos after a running turn", () => {
    expect(todoState({ count: 2, done: true, live: true })).toBe("close")
  })

  test("clears stale todos when the turn ends", () => {
    expect(todoState({ count: 2, done: false, live: false })).toBe("clear")
  })

  test("clears completed todos when the session is no longer live", () => {
    expect(todoState({ count: 2, done: true, live: false })).toBe("clear")
  })
})

describe("permission response stale cleanup", () => {
  test("treats matching PermissionNotFoundError as stale", () => {
    expect(
      isStalePermissionResponseFailure(
        { _tag: "PermissionNotFoundError", requestID: "perm-1", message: "Permission request not found" },
        permission("perm-1", "session-1"),
      ),
    ).toBe(true)
  })

  test("ignores PermissionNotFoundError for another pending permission", () => {
    expect(
      isStalePermissionResponseFailure(
        { _tag: "PermissionNotFoundError", requestID: "perm-2", message: "Permission request not found" },
        permission("perm-1", "session-1"),
      ),
    ).toBe(false)
  })

  test("treats request-not-found messages as stale", () => {
    expect(isStalePermissionResponseFailure(new Error("Permission request not found"), permission("perm-1", "session-1"))).toBe(
      true,
    )
  })

  test("treats name-discriminated PermissionNotFoundError with data message as stale", () => {
    expect(
      isStalePermissionResponseFailure(
        { name: "PermissionNotFoundError", data: { message: "Permission request not found" }, requestID: "perm-1" },
        permission("perm-1", "session-1"),
      ),
    ).toBe(true)
  })

  test("ignores name-discriminated PermissionNotFoundError for another pending permission", () => {
    expect(
      isStalePermissionResponseFailure(
        { name: "PermissionNotFoundError", data: { message: "Permission request not found" }, requestID: "perm-2" },
        permission("perm-1", "session-1"),
      ),
    ).toBe(false)
  })

  test("ignores request-not-found messages for another pending permission", () => {
    expect(
      isStalePermissionResponseFailure(
        { requestID: "perm-2", message: "Permission request not found" },
        permission("perm-1", "session-1"),
      ),
    ).toBe(false)
  })

  test("keeps typed session-not-found responses user-visible for direct permission replies", () => {
    expect(
      isStalePermissionResponseFailure(
        { _tag: "NotFoundError", message: "Session not found" },
        permission("perm-1", "session-1"),
      ),
    ).toBe(false)
  })

  test("keeps body-wrapped session-not-found responses user-visible for direct permission replies", () => {
    expect(
      isStalePermissionResponseFailure(
        new Error("Request failed", { cause: { body: { name: "NotFoundError", message: "Session not found" } } }),
        permission("perm-1", "session-1"),
      ),
    ).toBe(false)
  })

  test("keeps name-discriminated session-not-found responses user-visible for direct permission replies", () => {
    expect(
      isStalePermissionResponseFailure(
        { name: "NotFoundError", data: { message: "Session not found" }, requestID: "perm-1" },
        permission("perm-1", "session-1"),
      ),
    ).toBe(false)
  })

  test("keeps body-message session-not-found responses user-visible for direct permission replies", () => {
    expect(
      isStalePermissionResponseFailure(
        { name: "NotFoundError", message: "Session not found", requestID: "perm-1" },
        permission("perm-1", "session-1"),
      ),
    ).toBe(false)
  })

  test("keeps bare session-not-found errors user-visible", () => {
    expect(isStalePermissionResponseFailure(new Error("Session not found"), permission("perm-1", "session-1"))).toBe(
      false,
    )
  })

  test("keeps normal failures user-visible", () => {
    expect(isStalePermissionResponseFailure(new Error("Internal server error"), permission("perm-1", "session-1"))).toBe(
      false,
    )
  })

  test("removes only the stale permission request", () => {
    expect(
      removePermissionRequest(
        [permission("perm-1", "session-1"), permission("perm-2", "session-1")],
        permission("perm-1", "session-1"),
      ).map((item) => item.id),
    ).toEqual(["perm-2"])
  })
})
