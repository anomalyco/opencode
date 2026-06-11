import { describe, expect, it } from "bun:test"
import { SessionDirectory } from "@opencode-ai/core/session/directory"

describe("SessionDirectory", () => {
  it("normalizes Windows backslashes to forward slashes", () => {
    expect(SessionDirectory.normalizeSessionDirectory(String.raw`C:\Users\demo\project`)).toBe("C:/Users/demo/project")
  })

  it("leaves POSIX paths unchanged", () => {
    expect(SessionDirectory.normalizeSessionDirectory("/home/demo/project")).toBe("/home/demo/project")
  })
})
