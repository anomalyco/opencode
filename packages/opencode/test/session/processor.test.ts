import { describe, expect, test } from "bun:test"
import { SessionProcessor } from "../../src/session/processor"

describe("SessionProcessor.detectRepeatSnippet", () => {
  test("requires at least threshold entries before triggering", () => {
    const values = ["alpha", "alpha"]
    expect(SessionProcessor.detectRepeatSnippet(values, "alpha")).toBeUndefined()
  })

  test("returns the trimmed snippet when the last threshold entries match", () => {
    const values = ["foo", "foo", "foo"]
    expect(SessionProcessor.detectRepeatSnippet(values, "foo")).toBe("foo")
  })

  test("returns undefined when the latest entries diverge", () => {
    const values = ["foo", "foo", "bar", "foo"]
    expect(SessionProcessor.detectRepeatSnippet(values, "foo")).toBeUndefined()
  })

  test("trims long outputs before comparing", () => {
    const long = "x".repeat(2048)
    const expected = long.slice(-1024)
    const values = [long, long, long]
    expect(SessionProcessor.detectRepeatSnippet(values, long)).toBe(expected)
  })
})
