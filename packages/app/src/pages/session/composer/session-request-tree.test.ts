import { describe, expect, test } from "bun:test"
import type { QuestionRequest, Session } from "@opencode-ai/sdk/v2/client"
import { activeQuestion, sessionQuestionRequests } from "./session-request-tree"

const session = (id: string, parentID?: string) => ({ id, parentID }) as Session

const question = (id: string, sessionID: string) =>
  ({
    id,
    sessionID,
    questions: [],
  }) as QuestionRequest

describe("sessionQuestionRequests", () => {
  test("orders root and nested subagent questions globally", () => {
    const sessions = [
      session("root"),
      session("child-b", "root"),
      session("child-a", "root"),
      session("grand", "child-a"),
    ]
    const questions = {
      root: [question("que_04", "root")],
      "child-a": [question("que_03", "child-a")],
      "child-b": [question("que_01", "child-b")],
      grand: [question("que_02", "grand")],
    }

    expect(sessionQuestionRequests(sessions, questions, "root").map((item) => item.id)).toEqual([
      "que_01",
      "que_02",
      "que_03",
      "que_04",
    ])
  })

  test("keeps the active request until it leaves the queue", () => {
    const current = question("que_02", "child-b")
    const queue = [question("que_01", "child-a"), current, question("que_03", "root")]

    expect(activeQuestion(queue, current.id)).toBe(current)
    expect(
      activeQuestion(
        queue.filter((item) => item.id !== current.id),
        current.id,
      )?.id,
    ).toBe("que_01")
  })

  test("does not include questions from another session tree", () => {
    const sessions = [session("root"), session("child", "root"), session("other")]
    const questions = {
      child: [question("que_01", "child")],
      other: [question("que_00", "other")],
    }

    expect(sessionQuestionRequests(sessions, questions, "root").map((item) => item.id)).toEqual(["que_01"])
  })
})
