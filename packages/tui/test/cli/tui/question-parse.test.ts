import { describe, expect, test } from "bun:test"
import { parseQuestionAnswers, parseQuestions } from "../../../src/routes/session"

describe("question text parsing", () => {
  test("strips carriage returns from persisted question input", () => {
    expect(parseQuestions([{ question: "这\r是\r问\r题\r？", header: "验\r证" }])).toEqual([
      { question: "这是问题？" },
    ])
  })

  test("keeps newlines and strips carriage returns from answers", () => {
    expect(parseQuestions([{ question: "第一行\n第二行" }])).toEqual([{ question: "第一行\n第二行" }])
    expect(parseQuestionAnswers([["确认\r装\r Docker"]])).toEqual([["确认装 Docker"]])
  })
})
