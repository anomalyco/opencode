import { describe, expect, test } from "bun:test"
import { questionSubtitle } from "./session-prompt-helpers"

describe("questionSubtitle", () => {
  const t = (key: string) => {
    if (key === "ui.common.question.one") return "question"
    if (key === "ui.common.question.other") return "questions"
    return key
  }

  test("returns empty for zero", () => {
    expect(questionSubtitle(0, t)).toBe("")
  })

  test("uses singular label", () => {
    expect(questionSubtitle(1, t)).toBe("1 question")
  })

  test("uses plural label", () => {
    expect(questionSubtitle(3, t)).toBe("3 questions")
  })
})
