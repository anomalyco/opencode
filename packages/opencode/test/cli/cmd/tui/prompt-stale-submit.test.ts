import { describe, expect, test } from "bun:test"
import { isStalePermissionSubmitError } from "../../../../src/cli/cmd/tui/routes/session/permission"
import { isStaleQuestionSubmitError } from "../../../../src/cli/cmd/tui/routes/session/question"

describe("tui prompt stale submit classifiers", () => {
  test("question accepts typed SDK bodies and request-not-found messages for the displayed request", () => {
    expect(isStaleQuestionSubmitError({ _tag: "QuestionNotFoundError", requestID: "question-1" }, "question-1")).toBe(
      true,
    )
    expect(isStaleQuestionSubmitError({ name: "QuestionNotFoundError" }, "question-1")).toBe(true)
    expect(
      isStaleQuestionSubmitError({ body: { data: { message: "Question request not found: question-1" } } }, "question-1"),
    ).toBe(true)
    expect(
      isStaleQuestionSubmitError({ body: { data: { requestID: "question-1", message: "Question request not found" } } }, "question-1"),
    ).toBe(true)
    expect(isStaleQuestionSubmitError(new Error("Question request not found"), "question-1")).toBe(true)
    expect(
      isStaleQuestionSubmitError(
        { message: "Request failed", body: { data: { message: "Question request not found: question-1" } } },
        "question-1",
      ),
    ).toBe(true)
  })

  test("question rejects conflicting request IDs and unrelated failures", () => {
    expect(isStaleQuestionSubmitError({ _tag: "QuestionNotFoundError", requestID: "question-2" }, "question-1")).toBe(
      false,
    )
    expect(isStaleQuestionSubmitError({ body: { requestID: "question-2", message: "Question request not found" } }, "question-1")).toBe(false)
    expect(isStaleQuestionSubmitError({ body: { data: { message: "Question request not found: question-2" } } }, "question-1")).toBe(false)
    expect(
      isStaleQuestionSubmitError(
        { _tag: "QuestionNotFoundError", message: "Request failed", body: { data: { message: "Question request not found: question-2" } } },
        "question-1",
      ),
    ).toBe(false)
    expect(isStaleQuestionSubmitError("Question request not found: question-2", "question-1")).toBe(false)
    expect(isStaleQuestionSubmitError(new Error("Network failed"), "question-1")).toBe(false)
  })

  test("permission accepts typed SDK bodies and request-not-found messages for the displayed request", () => {
    expect(isStalePermissionSubmitError({ _tag: "PermissionNotFoundError", requestID: "perm-1" }, "perm-1")).toBe(
      true,
    )
    expect(isStalePermissionSubmitError({ name: "PermissionNotFoundError" }, "perm-1")).toBe(true)
    expect(
      isStalePermissionSubmitError({ body: { data: { message: "Permission request not found: perm-1" } } }, "perm-1"),
    ).toBe(true)
    expect(
      isStalePermissionSubmitError({ body: { data: { requestID: "perm-1", message: "Permission request not found" } } }, "perm-1"),
    ).toBe(true)
    expect(isStalePermissionSubmitError(new Error("Permission request not found"), "perm-1")).toBe(true)
    expect(
      isStalePermissionSubmitError(
        { message: "Request failed", body: { data: { message: "Permission request not found: perm-1" } } },
        "perm-1",
      ),
    ).toBe(true)
  })

  test("permission rejects conflicting request IDs and unrelated failures", () => {
    expect(isStalePermissionSubmitError({ _tag: "PermissionNotFoundError", requestID: "perm-2" }, "perm-1")).toBe(
      false,
    )
    expect(isStalePermissionSubmitError({ body: { requestID: "perm-2", message: "Permission request not found" } }, "perm-1")).toBe(false)
    expect(isStalePermissionSubmitError({ body: { data: { message: "Permission request not found: perm-2" } } }, "perm-1")).toBe(false)
    expect(
      isStalePermissionSubmitError(
        { _tag: "PermissionNotFoundError", message: "Request failed", body: { data: { message: "Permission request not found: perm-2" } } },
        "perm-1",
      ),
    ).toBe(false)
    expect(isStalePermissionSubmitError("Permission request not found: perm-2", "perm-1")).toBe(false)
    expect(isStalePermissionSubmitError(new Error("Network failed"), "perm-1")).toBe(false)
  })
})
