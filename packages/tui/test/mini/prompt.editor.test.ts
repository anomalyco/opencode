import { describe, expect, test } from "bun:test"
import { measureEditText } from "@opentui/core"
import { realignEditorPromptParts, resolveEditorSlashValue } from "../../src/mini/prompt.editor"
import type { RunPromptPart } from "../../src/mini/types"

describe("run prompt editor helpers", () => {
  test("strips the local /editor command from the initial editor text", () => {
    expect(resolveEditorSlashValue("/editor")).toBe("")
    expect(resolveEditorSlashValue("/editor draft message")).toBe("draft message")
    expect(resolveEditorSlashValue("/editor first line\nsecond line")).toBe("first line\nsecond line")
  })

  test("realigns file and agent parts after external editing", () => {
    const filePart = {
      type: "file",
      mime: "text/plain",
      filename: "src/app.ts",
      url: "file:///src/app.ts",
      source: {
        type: "file",
        path: "src/app.ts",
        text: {
          start: 0,
          end: 11,
          value: "@src/app.ts",
        },
      },
    } satisfies RunPromptPart
    const agentPart = {
      type: "agent",
      name: "helper",
      source: {
        start: 12,
        end: 19,
        value: "@helper",
      },
    } satisfies RunPromptPart
    const parts = [filePart, agentPart]

    expect(realignEditorPromptParts("Please check @helper before @src/app.ts", parts, "unicode")).toEqual([
      {
        ...filePart,
        source: {
          ...filePart.source,
          text: {
            ...filePart.source.text,
            start: 28,
            end: 39,
            value: "@src/app.ts",
          },
        },
      },
      {
        ...agentPart,
        source: {
          start: 13,
          end: 20,
          value: "@helper",
        },
      },
    ])
  })

  test("drops parts whose virtual text was deleted", () => {
    const filePart = {
      type: "file",
      mime: "text/plain",
      filename: "src/app.ts",
      url: "file:///src/app.ts",
      source: {
        type: "file",
        path: "src/app.ts",
        text: {
          start: 0,
          end: 11,
          value: "@src/app.ts",
        },
      },
    } satisfies RunPromptPart
    const agentPart = {
      type: "agent",
      name: "helper",
      source: {
        start: 12,
        end: 19,
        value: "@helper",
      },
    } satisfies RunPromptPart
    const parts = [filePart, agentPart]

    expect(realignEditorPromptParts("Only @helper remains", parts, "unicode")).toEqual([
      {
        ...agentPart,
        source: {
          start: 5,
          end: 12,
          value: "@helper",
        },
      },
    ])
  })

  test.each(["wcwidth", "unicode"] as const)("uses %s editor offsets when realigning Mini parts", (widthMethod) => {
    const part = {
      type: "agent",
      name: "助手",
      source: { start: 0, end: 5, value: "@助手" },
    } satisfies RunPromptPart
    const start = measureEditText("\t\f中文👨‍👩‍👧\r\n", { widthMethod })

    expect(realignEditorPromptParts("\t\f中文👨‍👩‍👧\r\n@助手", [part], widthMethod)).toEqual([
      {
        ...part,
        source: { start, end: start + 5, value: "@助手" },
      },
    ])
  })
})
