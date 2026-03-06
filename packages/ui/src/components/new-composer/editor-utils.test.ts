import { describe, expect, test } from "bun:test"
import { createTextFragment, getCursorPosition, getNodeLength, getTextLength, setCursorPosition } from "./editor-utils"

describe("new-composer editor utils", () => {
  test("createTextFragment preserves newlines with consecutive br nodes", () => {
    const fragment = createTextFragment("foo\n\nbar")
    const box = document.createElement("div")
    box.appendChild(fragment)

    expect(box.childNodes.length).toBe(4)
    expect(box.childNodes[0]?.textContent).toBe("foo")
    expect((box.childNodes[1] as HTMLElement).tagName).toBe("BR")
    expect((box.childNodes[2] as HTMLElement).tagName).toBe("BR")
    expect(box.childNodes[3]?.textContent).toBe("bar")
  })

  test("createTextFragment keeps trailing newline as terminal break", () => {
    const fragment = createTextFragment("foo\n")
    const box = document.createElement("div")
    box.appendChild(fragment)

    expect(box.childNodes.length).toBe(2)
    expect(box.childNodes[0]?.textContent).toBe("foo")
    expect((box.childNodes[1] as HTMLElement).tagName).toBe("BR")
  })

  test("createTextFragment avoids break-node explosion for large multiline content", () => {
    const value = Array.from({ length: 220 }, () => "line").join("\n")
    const fragment = createTextFragment(value)
    const box = document.createElement("div")
    box.appendChild(fragment)

    expect(box.childNodes.length).toBe(1)
    expect(box.childNodes[0]?.nodeType).toBe(Node.TEXT_NODE)
    expect(box.textContent).toBe(value)
  })

  test("createTextFragment keeps terminal break in large multiline fallback", () => {
    const value = `${Array.from({ length: 220 }, () => "line").join("\n")}\n`
    const fragment = createTextFragment(value)
    const box = document.createElement("div")
    box.appendChild(fragment)

    expect(box.childNodes.length).toBe(2)
    expect(box.childNodes[0]?.textContent).toBe(value.slice(0, -1))
    expect((box.childNodes[1] as HTMLElement).tagName).toBe("BR")
  })

  test("length helpers treat breaks as one char and ignore zero-width chars", () => {
    const box = document.createElement("div")
    box.appendChild(document.createTextNode("ab\u200B"))
    box.appendChild(document.createElement("br"))
    box.appendChild(document.createTextNode("cd"))

    expect(getNodeLength(box.childNodes[0]!)).toBe(2)
    expect(getNodeLength(box.childNodes[1]!)).toBe(1)
    expect(getTextLength(box)).toBe(5)
  })

  test("setCursorPosition and getCursorPosition round-trip with pills and breaks", () => {
    const box = document.createElement("div")
    const pill = document.createElement("span")
    pill.dataset.type = "file"
    pill.textContent = "@file"

    box.appendChild(document.createTextNode("ab"))
    box.appendChild(pill)
    box.appendChild(document.createElement("br"))
    box.appendChild(document.createTextNode("cd"))
    document.body.appendChild(box)

    setCursorPosition(box, 2)
    expect(getCursorPosition(box)).toBe(2)

    setCursorPosition(box, 7)
    expect(getCursorPosition(box)).toBe(7)

    setCursorPosition(box, 8)
    expect(getCursorPosition(box)).toBe(8)

    box.remove()
  })

  test("setCursorPosition and getCursorPosition round-trip across blank lines", () => {
    const box = document.createElement("div")
    box.appendChild(document.createTextNode("a"))
    box.appendChild(document.createElement("br"))
    box.appendChild(document.createElement("br"))
    box.appendChild(document.createTextNode("b"))
    document.body.appendChild(box)

    setCursorPosition(box, 2)
    expect(getCursorPosition(box)).toBe(2)

    setCursorPosition(box, 3)
    expect(getCursorPosition(box)).toBe(3)

    box.remove()
  })
})
