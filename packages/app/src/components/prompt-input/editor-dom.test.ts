import { describe, expect, test } from "bun:test"
import { createTextFragment, getCursorPosition, getNodeLength, getTextLength, setCursorPosition } from "./editor-dom"

describe("prompt-input editor dom", () => {
  test("createTextFragment preserves newlines with consecutive br nodes", () => {
    const fragment = createTextFragment("foo\n\nbar")
    const container = document.createElement("div")
    container.appendChild(fragment)

    expect(container.childNodes.length).toBe(4)
    expect(container.childNodes[0]?.textContent).toBe("foo")
    expect((container.childNodes[1] as HTMLElement).tagName).toBe("BR")
    expect((container.childNodes[2] as HTMLElement).tagName).toBe("BR")
    expect(container.childNodes[3]?.textContent).toBe("bar")
  })

  test("createTextFragment keeps trailing newline as terminal break", () => {
    const fragment = createTextFragment("foo\n")
    const container = document.createElement("div")
    container.appendChild(fragment)

    expect(container.childNodes.length).toBe(2)
    expect(container.childNodes[0]?.textContent).toBe("foo")
    expect((container.childNodes[1] as HTMLElement).tagName).toBe("BR")
  })

  test("createTextFragment avoids break-node explosion for large multiline content", () => {
    const content = Array.from({ length: 220 }, () => "line").join("\n")
    const fragment = createTextFragment(content)
    const container = document.createElement("div")
    container.appendChild(fragment)

    expect(container.childNodes.length).toBe(1)
    expect(container.childNodes[0]?.nodeType).toBe(Node.TEXT_NODE)
    expect(container.textContent).toBe(content)
  })

  test("createTextFragment keeps terminal break in large multiline fallback", () => {
    const content = `${Array.from({ length: 220 }, () => "line").join("\n")}\n`
    const fragment = createTextFragment(content)
    const container = document.createElement("div")
    container.appendChild(fragment)

    expect(container.childNodes.length).toBe(2)
    expect(container.childNodes[0]?.textContent).toBe(content.slice(0, -1))
    expect((container.childNodes[1] as HTMLElement).tagName).toBe("BR")
  })

  test("length helpers treat breaks as one char and ignore zero-width chars", () => {
    const container = document.createElement("div")
    container.appendChild(document.createTextNode("ab\u200B"))
    container.appendChild(document.createElement("br"))
    container.appendChild(document.createTextNode("cd"))

    expect(getNodeLength(container.childNodes[0]!)).toBe(2)
    expect(getNodeLength(container.childNodes[1]!)).toBe(1)
    expect(getTextLength(container)).toBe(5)
  })

  test("length helpers count block siblings like parsed prompt text", () => {
    const container = document.createElement("div")
    const a = document.createElement("div")
    const b = document.createElement("div")
    a.textContent = "foo"
    b.textContent = "bar"
    container.appendChild(a)
    container.appendChild(b)

    expect(getNodeLength(a)).toBe(3)
    expect(getTextLength(container)).toBe(7)
  })

  test("length helpers normalize CRLF to single newlines", () => {
    const container = document.createElement("div")
    container.appendChild(document.createTextNode("a\r\nb"))

    expect(getNodeLength(container.childNodes[0]!)).toBe(3)
    expect(getTextLength(container)).toBe(3)
  })

  test("setCursorPosition and getCursorPosition round-trip with pills and breaks", () => {
    const container = document.createElement("div")
    const pill = document.createElement("span")
    pill.dataset.type = "file"
    pill.textContent = "@file"
    container.appendChild(document.createTextNode("ab"))
    container.appendChild(pill)
    container.appendChild(document.createElement("br"))
    container.appendChild(document.createTextNode("cd"))
    document.body.appendChild(container)

    setCursorPosition(container, 2)
    expect(getCursorPosition(container)).toBe(2)

    setCursorPosition(container, 7)
    expect(getCursorPosition(container)).toBe(7)

    setCursorPosition(container, 8)
    expect(getCursorPosition(container)).toBe(8)

    container.remove()
  })

  test("setCursorPosition and getCursorPosition round-trip across blank lines", () => {
    const container = document.createElement("div")
    container.appendChild(document.createTextNode("a"))
    container.appendChild(document.createElement("br"))
    container.appendChild(document.createElement("br"))
    container.appendChild(document.createTextNode("b"))
    document.body.appendChild(container)

    setCursorPosition(container, 2)
    expect(getCursorPosition(container)).toBe(2)

    setCursorPosition(container, 3)
    expect(getCursorPosition(container)).toBe(3)

    container.remove()
  })

  test("setCursorPosition and getCursorPosition round-trip across pasted block lines", () => {
    const container = document.createElement("div")
    const a = document.createElement("div")
    const b = document.createElement("div")
    a.textContent = "foo"
    b.textContent = "bar"
    container.appendChild(a)
    container.appendChild(b)
    document.body.appendChild(container)

    setCursorPosition(container, 3)
    expect(getCursorPosition(container)).toBe(3)

    setCursorPosition(container, 4)
    expect(getCursorPosition(container)).toBe(4)

    setCursorPosition(container, 7)
    expect(getCursorPosition(container)).toBe(7)

    container.remove()
  })

  test("setCursorPosition keeps the caret inside an empty editor", () => {
    const container = document.createElement("div")
    document.body.appendChild(container)

    setCursorPosition(container, 0)

    const selection = window.getSelection()
    expect(selection?.anchorNode).toBe(container)
    expect(selection?.anchorOffset).toBe(0)

    container.remove()
  })

  test("setCursorPosition keeps block-boundary cursors inside empty pasted lines", () => {
    const container = document.createElement("div")
    const a = document.createElement("div")
    const b = document.createElement("div")
    a.textContent = "foo"
    container.appendChild(a)
    container.appendChild(b)
    document.body.appendChild(container)

    setCursorPosition(container, 4)
    expect(getCursorPosition(container)).toBe(4)

    const selection = window.getSelection()
    expect(selection?.anchorNode).toBe(b)
    expect(selection?.anchorOffset).toBe(0)

    container.remove()
  })
})
