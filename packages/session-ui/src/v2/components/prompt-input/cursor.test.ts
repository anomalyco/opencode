import { describe, expect, test } from "bun:test"
import { promptInputV2CursorOffset } from "./cursor"

const text = (content: string) =>
  ({
    nodeType: 3,
    textContent: content,
    childNodes: [],
  }) as unknown as Node

const element = (tagName: string, ...childNodes: Node[]) =>
  ({
    nodeType: 1,
    tagName,
    childNodes,
    textContent: childNodes.map((node) => node.textContent ?? "").join(""),
  }) as unknown as HTMLElement

describe("promptInputV2CursorOffset", () => {
  test("counts line breaks before the caret", () => {
    const last = text("see @fo")
    const editor = element("DIV", text("line1"), element("BR"), text("line2"), element("BR"), last)

    expect(promptInputV2CursorOffset(editor, last, 7)).toBe(19)
  })

  test("counts separators between block elements", () => {
    const last = text("see @fo")
    const editor = element("DIV", element("DIV", text("line1")), element("P", last))

    expect(promptInputV2CursorOffset(editor, last, 7)).toBe(13)
    expect(promptInputV2CursorOffset(editor, editor, 1)).toBe(6)
  })
})
