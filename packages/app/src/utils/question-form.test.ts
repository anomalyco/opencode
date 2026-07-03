import { describe, expect, test } from "bun:test"
import { questionAnswer, type QuestionField } from "./question-form"

describe("questionAnswer", () => {
  test("falls back to field defaults", () => {
    const fields = [
      { key: "name", type: "string", default: "Ada" },
      { key: "age", type: "integer", default: 42 },
      { key: "newsletter", type: "boolean", default: false },
      { key: "colors", type: "multiselect", options: [], default: ["red"] },
    ] satisfies QuestionField[]

    expect(questionAnswer(fields, [[], [], [], []])).toEqual({
      name: "Ada",
      age: 42,
      newsletter: false,
      colors: ["red"],
    })
  })

  test("uses explicit answers over defaults", () => {
    const fields = [
      { key: "name", type: "string", default: "Ada" },
      { key: "age", type: "number", default: 42 },
      { key: "newsletter", type: "boolean", default: false },
      { key: "colors", type: "multiselect", options: [], default: ["red"] },
    ] satisfies QuestionField[]

    expect(questionAnswer(fields, [["Grace"], ["36"], ["true"], ["blue"]])).toEqual({
      name: "Grace",
      age: 36,
      newsletter: true,
      colors: ["blue"],
    })
  })
})
