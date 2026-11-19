import { describe, expect, test } from "bun:test"
import { planToolCalls, type ToolSpec } from "../src/planner"

const tools: ToolSpec[] = ["read", "bash", "glob", "grep", "write", "edit", "list", "webfetch"].map(
  (name) => ({ name, description: name }),
)

describe("planToolCalls", () => {
  test("plans a read for an explicit file path", () => {
    const plan = planToolCalls(tools, "прочитай файл package.json")

    expect(plan.calls[0]?.name).toBe("read")
    expect(plan.calls[0]?.arguments.filePath).toBe("package.json")
  })

  test("plans a shell command with the whole command text", () => {
    const plan = planToolCalls(tools, "запусти git status")

    expect(plan.calls[0]).toEqual({ name: "bash", arguments: { command: "git status" } })
  })

  test("plans a glob for a file pattern", () => {
    const plan = planToolCalls(tools, "найди все файлы *.ts")

    expect(plan.calls[0]?.name).toBe("glob")
    expect(plan.calls[0]?.arguments.pattern).toBe("*.ts")
  })

  test("plans a webfetch for a URL", () => {
    const plan = planToolCalls(tools, "загрузи https://example.com/docs")

    expect(plan.calls[0]).toEqual({
      name: "webfetch",
      arguments: { url: "https://example.com/docs" },
    })
  })

  test("does not plan tools for a general question", () => {
    expect(planToolCalls(tools, "что такое замыкание?").calls).toEqual([])
  })

  test("ignores intents when the tool is not offered", () => {
    const plan = planToolCalls([{ name: "read", description: "" }], "запусти git status")

    expect(plan.calls).toEqual([])
  })
})
