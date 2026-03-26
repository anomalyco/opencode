import { describe, test, expect } from "bun:test"
import { safePath } from "../path"

describe("Path Traversal Prevention", () => {
  test("allows valid path within base", () => {
    expect(safePath("/home/user/project", "src/index.ts")).not.toBeNull()
  })
  test("blocks path traversal", () => {
    expect(safePath("/home/user/project", "../../etc/passwd")).toBeNull()
  })
  test("blocks NUL byte injection", () => {
    expect(safePath("/home/user/project", "file\x00.ts")).toBeNull()
  })
})
