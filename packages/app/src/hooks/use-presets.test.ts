import { describe, test, expect } from "bun:test"
import { extractVariables, resolveVariables } from "./use-presets"

describe("extractVariables", () => {
  test("extracts single variable", () => {
    expect(extractVariables("Hello {name}")).toEqual(["name"])
  })

  test("extracts multiple variables", () => {
    expect(extractVariables("{date} {time} {file}")).toEqual(["date", "time", "file"])
  })

  test("deduplicates variables", () => {
    expect(extractVariables("{name} and {name}")).toEqual(["name"])
  })

  test("returns empty array for no variables", () => {
    expect(extractVariables("No variables here")).toEqual([])
  })

  test("handles empty string", () => {
    expect(extractVariables("")).toEqual([])
  })

  test("extracts all supported variable types", () => {
    const content = "Date: {date}, Time: {time}, File: {file}, Code: {code}, Text: {text}"
    expect(extractVariables(content)).toEqual(["date", "time", "file", "code", "text"])
  })
})

describe("resolveVariables", () => {
  test("resolves single variable", () => {
    expect(resolveVariables("Hello {name}", { name: "World" })).toBe("Hello World")
  })

  test("resolves multiple variables", () => {
    expect(resolveVariables("{date} {time}", { date: "2026-01-01", time: "12:00" })).toBe("2026-01-01 12:00")
  })

  test("keeps unresolved variables as-is", () => {
    expect(resolveVariables("Hello {name}", {})).toBe("Hello {name}")
  })

  test("handles empty string", () => {
    expect(resolveVariables("", { name: "World" })).toBe("")
  })

  test("handles empty values", () => {
    expect(resolveVariables("Hello {name}", {})).toBe("Hello {name}")
  })

  test("resolves duplicate variables", () => {
    expect(resolveVariables("{name} and {name}", { name: "World" })).toBe("World and World")
  })
})
