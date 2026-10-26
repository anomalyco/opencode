import { expect, test } from "bun:test"
import { setCursorPosition } from "./dom"

const br = () => document.createElement("br")

const text = (value: string) => document.createTextNode(value)

const pill = () => {
  const element = document.createElement("span")
  element.dataset.mention = "file"
  element.textContent = "@file"

  return element
}

// Breaks count as one character and zero-width characters count as none.
// Each caret row is [position, anchor child index or null for the container, anchor offset].
test.each<{ name: string; nodes: () => Node[]; caret: [number, number | null, number][] }>([
  {
    name: "zero-width characters",
    nodes: () => [text("ab\u200B"), br(), text("cd")],
    caret: [
      [3, 2, 0],
      [4, 2, 1],
    ],
  },
  {
    name: "pills and breaks",
    nodes: () => [text("ab"), pill(), br(), text("cd")],
    caret: [
      [2, 0, 2],
      [7, null, 2],
      [8, 3, 0],
    ],
  },
  {
    name: "blank lines",
    nodes: () => [text("a"), br(), br(), text("b")],
    caret: [
      [2, null, 2],
      [3, 3, 0],
    ],
  },
])("maps the caret across $name", (row) => {
  const container = document.createElement("div")
  container.append(...row.nodes())
  document.body.appendChild(container)

  row.caret.forEach(([position, child, offset]) => {
    setCursorPosition(container, position)
    const selection = window.getSelection()
    expect(selection?.anchorNode).toBe(child === null ? container : container.childNodes[child]!)
    expect(selection?.anchorOffset).toBe(offset)
  })

  container.remove()
})
