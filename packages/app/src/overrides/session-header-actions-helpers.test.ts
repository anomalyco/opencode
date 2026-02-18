import { describe, expect, test } from "bun:test"
import { extractDirectory } from "./session-header-actions-helpers"

describe("extractDirectory", () => {
  test("returns string as-is", () => {
    expect(extractDirectory("/home/ubuntu/projects/app")).toBe("/home/ubuntu/projects/app")
  })

  test("returns first element from array", () => {
    expect(extractDirectory(["/home/ubuntu/projects/app", "/home/ubuntu/projects/other"])).toBe(
      "/home/ubuntu/projects/app",
    )
  })

  test("returns single element from array", () => {
    expect(extractDirectory(["/home/ubuntu/projects/app"])).toBe("/home/ubuntu/projects/app")
  })

  test("returns null for empty array", () => {
    expect(extractDirectory([])).toBeNull()
  })

  test("returns null for null input", () => {
    expect(extractDirectory(null)).toBeNull()
  })
})
