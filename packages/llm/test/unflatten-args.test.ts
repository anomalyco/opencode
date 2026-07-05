import { describe, expect, test } from "bun:test"
import { unflattenArgs } from "../src/protocols/utils/unflatten-args"

describe("unflattenArgs", () => {
  test("returns null/undefined as-is", () => {
    expect(unflattenArgs(null)).toBe(null)
    expect(unflattenArgs(undefined)).toBe(undefined)
  })

  test("returns empty object as-is", () => {
    const obj = {}
    expect(unflattenArgs(obj)).toBe(obj)
  })

  test("returns already-nested object unchanged", () => {
    const obj = { name: "hello", nested: { a: 1 } }
    expect(unflattenArgs(obj)).toBe(obj)
  })

  test("passes through dot-only keys (no brackets)", () => {
    const obj = { "a.b": "val" }
    expect(unflattenArgs(obj)).toBe(obj)
  })

  test("unflattens bracket notation", () => {
    expect(unflattenArgs({ "a[0]": "val" })).toEqual({ a: ["val"] })
  })

  test("unflattens deep mixed notation", () => {
    expect(
      unflattenArgs({ "questions[0].header": "Auth" }),
    ).toEqual({ questions: [{ header: "Auth" }] })
  })

  test("unflattens multiple array items", () => {
    expect(
      unflattenArgs({
        "a[0].x": 1,
        "a[1].x": 2,
      }),
    ).toEqual({ a: [{ x: 1 }, { x: 2 }] })
  })

  test("handles the issue #35105 example", () => {
    const flat = {
      "questions[0].question": "Which auth method?",
      "questions[0].header": "Auth",
      "questions[0].options[0].label": "OAuth",
      "questions[0].options[0].description": "Use OAuth",
      "questions[0].options[1].label": "JWT",
      "questions[0].options[1].description": "Use JWT",
      "questions[0].multiSelect": false,
    }
    expect(unflattenArgs(flat)).toEqual({
      questions: [
        {
          question: "Which auth method?",
          header: "Auth",
          options: [
            { label: "OAuth", description: "Use OAuth" },
            { label: "JWT", description: "Use JWT" },
          ],
          multiSelect: false,
        },
      ],
    })
  })

  test("preserves non-bracket keys alongside bracket keys", () => {
    expect(
      unflattenArgs({
        plain: "yes",
        "arr[0]": "val",
      }),
    ).toEqual({ plain: "yes", arr: ["val"] })
  })

  test("handles malformed key with missing closing bracket", () => {
    // Should not hang — partial token is ignored
    const result = unflattenArgs({ "a[0": "val" })
    expect(result).toBeDefined()
  })

  test("rejects prototype pollution attempts", () => {
    const result = unflattenArgs({ "__proto__[0]": "evil" }) as any
    expect(({} as any).constructor).toBeDefined() // Object.prototype untouched
    expect(result["__proto__"] ?? undefined).toBeUndefined()
  })
})
