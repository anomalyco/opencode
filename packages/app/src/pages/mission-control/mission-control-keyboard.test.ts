import { describe, expect, test } from "bun:test"
import { missionControlEditor } from "./mission-control-keyboard"

describe("mission control keyboard shortcuts", () => {
  test("ignore native form controls", () => {
    const input = document.createElement("input")
    const textarea = document.createElement("textarea")
    const select = document.createElement("select")

    expect(missionControlEditor(input)).toBe(input)
    expect(missionControlEditor(textarea)).toBe(textarea)
    expect(missionControlEditor(select)?.tagName).toBe("SELECT")
  })

  test("ignore the prompt editor and its nested content", () => {
    const editor = document.createElement("div")
    const content = document.createElement("span")
    editor.contentEditable = "true"
    editor.append(content)

    expect(missionControlEditor(editor)).toBe(editor)
    expect(missionControlEditor(content)).toBe(editor)
  })

  test("allow shortcuts outside editors", () => {
    expect(missionControlEditor(document.createElement("div"))).toBeUndefined()
    expect(missionControlEditor(document.createElement("button"))).toBeUndefined()
  })
})
