import { expect, test } from "bun:test"
import { letterAt, letterIndex } from "../src/session/timeline/place"

// A row's text is spread over nested elements, and a view that is built again has other text nodes for it.
const markup =
  "<p>Read the <code>config</code> file, <strong>then <em>restart</em></strong> it.</p><p>Second paragraph.</p>"

function row() {
  const element = document.createElement("div")
  element.innerHTML = markup

  return element
}

test("names a letter of a row by the letters before it, and finds it again in a row that was built again", () => {
  const left = row()
  const word = left.querySelector("em")?.firstChild

  if (!(word instanceof Text)) throw new Error("The row has no emphasized text")
  const index = letterIndex(left, word, 3)
  expect(index).toBe("Read the config file, then res".length)

  const back = letterAt(row(), index!)
  expect(back?.node.data).toBe("restart")
  expect(back?.offset).toBe(3)
})

test("gives no letter for text outside the row, and the last letter for a row whose text got shorter", () => {
  expect(letterIndex(row(), document.createTextNode("elsewhere"), 2)).toBeUndefined()

  const end = letterAt(row(), 10_000)
  expect(end?.node.data).toBe("Second paragraph.")
  expect(end?.offset).toBe("Second paragraph.".length - 1)
})
