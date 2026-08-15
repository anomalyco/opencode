import { describe, expect, test } from "bun:test"
import { LLMRepair } from "../../src/session/llm/repair"

describe("session.llm.repair", () => {
  test("returns undefined for valid JSON", () => {
    expect(LLMRepair.repair('{"path": "a.txt"}')).toBeUndefined()
    expect(LLMRepair.repair('{"count": 3, "flag": true}')).toBeUndefined()
    expect(LLMRepair.repair("")).toBeUndefined()
  })

  test("removes trailing commas", () => {
    expect(LLMRepair.repair('{"path": "a.txt",}')).toBe('{"path": "a.txt"}')
    expect(LLMRepair.repair('{"items": [1, 2, 3,],}')).toBe('{"items": [1, 2, 3]}')
  })

  test("rewrites single-quoted keys and strings to double quotes", () => {
    expect(LLMRepair.repair("{'path': 'a.txt'}")).toBe('{"path": "a.txt"}')
    expect(JSON.parse(LLMRepair.repair("{'msg': 'it\\'s here'}")!)).toEqual({ msg: "it's here" })
    expect(JSON.parse(LLMRepair.repair(`{'quote': 'say "hi"'}`)!)).toEqual({ quote: 'say "hi"' })
  })

  test("normalizes smart quotes", () => {
    expect(LLMRepair.repair('{“path”: “a.txt”}')).toBe('{"path": "a.txt"}')
    expect(LLMRepair.repair("{‘path’: ‘a.txt’}")).toBe('{"path": "a.txt"}')
  })

  test("converts python literals outside strings", () => {
    expect(LLMRepair.repair('{"flag": True, "other": False, "empty": None}')).toBe(
      '{"flag": true, "other": false, "empty": null}',
    )
    // Literals inside strings stay untouched; the trailing comma still triggers a repair.
    expect(LLMRepair.repair('{"note": "None shall pass",}')).toBe('{"note": "None shall pass"}')
  })

  test("closes unbalanced brackets and braces", () => {
    expect(LLMRepair.repair('{"path": "a.txt"')).toBe('{"path": "a.txt"}')
    expect(LLMRepair.repair('{"items": [1, 2')).toBe('{"items": [1, 2]}')
    expect(LLMRepair.repair('{"path": "a.tx')).toBe('{"path": "a.tx"}')
  })

  test("combines repairs", () => {
    expect(JSON.parse(LLMRepair.repair("{'flag': True, 'path': 'a.txt',")!)).toEqual({
      flag: true,
      path: "a.txt",
    })
  })

  test("returns undefined when repair does not produce valid JSON", () => {
    expect(LLMRepair.repair("not json at all")).toBeUndefined()
    expect(LLMRepair.repair('{"path": }')).toBeUndefined()
  })
})
