import { describe, expect, test } from "bun:test"
import type { QuestionRequest } from "@opencode-ai/sdk/v2/client"
import { isStaleQuestionResponseFailure, removeQuestionRequest } from "./session-question-dock"

const question = (id: string, sessionID: string) =>
  ({
    id,
    sessionID,
    questions: [],
  }) as QuestionRequest

describe("question response stale cleanup", () => {
  test("treats matching QuestionNotFoundError as stale", () => {
    expect(
      isStaleQuestionResponseFailure(
        { _tag: "QuestionNotFoundError", requestID: "question-1", message: "Question request not found" },
        question("question-1", "session-1"),
      ),
    ).toBe(true)
  })

  test("ignores QuestionNotFoundError for another pending question", () => {
    expect(
      isStaleQuestionResponseFailure(
        { _tag: "QuestionNotFoundError", requestID: "question-2", message: "Question request not found" },
        question("question-1", "session-1"),
      ),
    ).toBe(false)
  })

  test("treats request-not-found messages as stale", () => {
    expect(isStaleQuestionResponseFailure(new Error("Question request not found"), question("question-1", "session-1"))).toBe(
      true,
    )
  })

  test("treats name-discriminated QuestionNotFoundError with data message as stale", () => {
    expect(
      isStaleQuestionResponseFailure(
        { name: "QuestionNotFoundError", data: { message: "Question request not found" }, requestID: "question-1" },
        question("question-1", "session-1"),
      ),
    ).toBe(true)
  })

  test("ignores request-not-found messages for another pending question", () => {
    expect(
      isStaleQuestionResponseFailure(
        { requestID: "question-2", message: "Question request not found" },
        question("question-1", "session-1"),
      ),
    ).toBe(false)
  })

  test("keeps normal failures user-visible", () => {
    expect(isStaleQuestionResponseFailure(new Error("Internal server error"), question("question-1", "session-1"))).toBe(
      false,
    )
  })

  test("removes only the stale question request", () => {
    expect(
      removeQuestionRequest(
        [question("question-1", "session-1"), question("question-2", "session-1")],
        question("question-1", "session-1"),
      ).map((item) => item.id),
    ).toEqual(["question-2"])
  })
})
