import { describe, expect, test } from "bun:test"
import { extractJson, scenePrompt, uiPrompt } from "./ai"
import { createScene } from "./scene/model"
import { createUiDocument } from "./ui/model"

describe("design AI responses", () => {
  test("extracts JSON from plain and fenced responses", () => {
    expect(extractJson('{"version":1,"objects":[]}')).toEqual({ version: 1, objects: [] })
    expect(extractJson('```json\n{"version":1,"objects":[]}\n```')).toEqual({ version: 1, objects: [] })
    expect(extractJson("not json")).toBeUndefined()
    expect(extractJson("```json\n{bad}\n```")).toBeUndefined()
  })

  test("includes the current scene and request in the prompt", () => {
    const prompt = scenePrompt(createScene(), "add a red cube")

    expect(prompt).toContain("add a red cube")
    expect(prompt).toContain('"objects": []')
    expect(prompt).toContain("Return only JSON")
  })

  test("includes the current page and request in the prompt", () => {
    const prompt = uiPrompt(createUiDocument("landing"), "make it dark")

    expect(prompt).toContain("make it dark")
    expect(prompt).toContain('"template": "landing"')
    expect(prompt).toContain("Return only JSON")
  })
})
