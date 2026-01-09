import { describe, expect, test } from "bun:test"
import { hasTodoKeywords, isTodoContinuationRequest } from "../../src/session/todo-continuation"

describe("isTodoContinuationRequest", () => {
  test("accepts explicit short continuation requests", () => {
    expect(isTodoContinuationRequest("Давай продолжим todo")).toBe(true)
    expect(isTodoContinuationRequest("продолжай туду")).toBe(true)
    expect(isTodoContinuationRequest("дальше по списку задач")).toBe(true)
    expect(isTodoContinuationRequest("continue todos")).toBe(true)
    expect(isTodoContinuationRequest("continue the todo list with step 2")).toBe(true)
  })

  test("hasTodoKeywords detects todo/task references", () => {
    expect(hasTodoKeywords("continue")).toBe(false)
    expect(hasTodoKeywords("продолжай")).toBe(false)
    expect(hasTodoKeywords("todo")).toBe(true)
    expect(hasTodoKeywords("tudU")).toBe(false)
    expect(hasTodoKeywords("туду")).toBe(true)
    expect(hasTodoKeywords("список задач")).toBe(true)
    expect(hasTodoKeywords("task list")).toBe(true)
  })

  test("does not treat generic continuation as todo continuation", () => {
    expect(isTodoContinuationRequest("Давай продолжим")).toBe(false)
    expect(isTodoContinuationRequest("продолжай")).toBe(false)
    expect(isTodoContinuationRequest("continue")).toBe(false)
    expect(isTodoContinuationRequest("continue with step 2")).toBe(false)
  })

  test("rejects long messages that only mention continuation words inside logs", () => {
    expect(
      isTodoContinuationRequest(
        [
          "У нас приложение Open Code зацикливалось.",
          "Вот вывод консоли пользователя:",
          "Thinking: Пользователь говорит \"Давай продолжим\".",
          "Система напоминает о незавершенных задачах.",
        ].join("\n"),
      ),
    ).toBe(false)
  })

  test("rejects non-leading continuation words in longer messages", () => {
    expect(
      isTodoContinuationRequest(
        "Я видел в логе слово continue, но это не просьба продолжить туду. Давай разберемся, что сломалось.",
      ),
    ).toBe(false)
  })
})
