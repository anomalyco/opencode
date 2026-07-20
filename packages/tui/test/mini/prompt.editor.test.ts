import { describe, expect, test } from "bun:test"
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

    expect(realignEditorPromptParts("Please check @helper before @src/app.ts", parts)).toEqual([
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

    expect(realignEditorPromptParts("Only @helper remains", parts)).toEqual([
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

  test("uses display offsets when realigning Mini parts", () => {
    const part = {
      type: "agent",
      name: "helper",
      source: { start: 0, end: 7, value: "@helper" },
    } satisfies RunPromptPart

    expect(realignEditorPromptParts("中文🙂\n@helper", [part])).toEqual([
      {
        ...part,
        source: { start: 7, end: 14, value: "@helper" },
      },
    ])
  })
})
