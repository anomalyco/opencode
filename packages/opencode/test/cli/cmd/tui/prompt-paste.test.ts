import { describe, expect, test } from "bun:test"
import { displayOffsetIndex, promptOffsetWidth } from "../../../../src/cli/cmd/prompt-display"
import { expandPromptTextParts } from "../../../../src/cli/cmd/tui/component/prompt/paste"
import type { PromptInfo } from "../../../../src/cli/cmd/tui/component/prompt/history"

describe("displayOffsetIndex", () => {
  test("maps display offsets across wide characters and newlines", () => {
    expect(displayOffsetIndex("第一行\n中文x", 11)).toBe("第一行\n中文".length)
  })
})

describe("expandPromptTextParts", () => {
  test("expands summarized paste text after wide characters", () => {
    const virtualText = "[Pasted ~3 lines]"
    const pastedText = "第一行\n第二行\n第三行"
    const start = promptOffsetWidth("中文abc")
    const end = start + promptOffsetWidth(virtualText)
    const parts = [
      {
        type: "text",
        text: pastedText,
        source: {
          text: {
            start,
            end,
            value: virtualText,
          },
        },
      },
    ] satisfies PromptInfo["parts"]

    expect(
      expandPromptTextParts(
        `中文abc${virtualText} 后文`,
        [{ id: 1, start, end }],
        new Map([[1, 0]]),
        parts,
      ),
    ).toBe(`中文abc${pastedText} 后文`)
  })

  test("expands multiple summarized paste blocks using their original visual ranges", () => {
    const firstVirtualText = "[Pasted ~2 lines]"
    const secondVirtualText = "[Pasted ~3 lines]"
    const firstPastedText = "一\n二"
    const secondPastedText = "甲\n乙\n丙"
    const beforeFirst = "开头中文"
    const between = " 中段中文"
    const firstStart = promptOffsetWidth(beforeFirst)
    const firstEnd = firstStart + promptOffsetWidth(firstVirtualText)
    const secondStart = promptOffsetWidth(`${beforeFirst}${firstVirtualText}${between}`)
    const secondEnd = secondStart + promptOffsetWidth(secondVirtualText)
    const parts = [
      {
        type: "text",
        text: firstPastedText,
        source: {
          text: {
            start: firstStart,
            end: firstEnd,
            value: firstVirtualText,
          },
        },
      },
      {
        type: "text",
        text: secondPastedText,
        source: {
          text: {
            start: secondStart,
            end: secondEnd,
            value: secondVirtualText,
          },
        },
      },
    ] satisfies PromptInfo["parts"]

    expect(
      expandPromptTextParts(
        `${beforeFirst}${firstVirtualText}${between}${secondVirtualText}结尾`,
        [
          { id: 1, start: firstStart, end: firstEnd },
          { id: 2, start: secondStart, end: secondEnd },
        ],
        new Map([
          [1, 0],
          [2, 1],
        ]),
        parts,
      ),
    ).toBe(`${beforeFirst}${firstPastedText}${between}${secondPastedText}结尾`)
  })

  test("falls back to virtual text when an extmark was shifted by string length", () => {
    const virtualText = "[Pasted ~2 lines]"
    const pastedText = "第一行\n第二行"
    const input = `abc中${virtualText}结尾`
    const start = "abc中".length
    const end = start + virtualText.length
    const parts = [
      {
        type: "text",
        text: pastedText,
        source: {
          text: {
            start,
            end,
            value: virtualText,
          },
        },
      },
    ] satisfies PromptInfo["parts"]

    expect(expandPromptTextParts(input, [{ id: 1, start, end }], new Map([[1, 0]]), parts)).toBe(
      `abc中${pastedText}结尾`,
    )
  })
})
