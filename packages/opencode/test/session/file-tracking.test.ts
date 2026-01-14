import { describe, expect, test, beforeEach } from "bun:test"
import { FileTracking } from "../../src/session/file-tracking"

describe("FileTracking", () => {
  beforeEach(() => {
    // Clear any existing tracking data
    FileTracking.clear("test-session")
  })

  test("addGitModified adds files to tracking", () => {
    FileTracking.addGitModified("test-session", ["/path/to/file1.ts", "/path/to/file2.ts"])

    expect(FileTracking.isGitModified("test-session", "/path/to/file1.ts")).toBe(true)
    expect(FileTracking.isGitModified("test-session", "/path/to/file2.ts")).toBe(true)
    expect(FileTracking.isGitModified("test-session", "/path/to/file3.ts")).toBe(false)
  })

  test("addGitModified handles empty array", () => {
    FileTracking.addGitModified("test-session", [])
    expect(FileTracking.getGitModified("test-session").size).toBe(0)
  })

  test("getGitModified returns empty set for unknown session", () => {
    const result = FileTracking.getGitModified("unknown-session")
    expect(result.size).toBe(0)
  })

  test("isGitModified returns false for unknown session", () => {
    expect(FileTracking.isGitModified("unknown-session", "/path/to/file.ts")).toBe(false)
  })

  test("clear removes all tracked files for session", () => {
    FileTracking.addGitModified("test-session", ["/path/to/file1.ts"])
    expect(FileTracking.isGitModified("test-session", "/path/to/file1.ts")).toBe(true)

    FileTracking.clear("test-session")
    expect(FileTracking.isGitModified("test-session", "/path/to/file1.ts")).toBe(false)
  })

  test("multiple sessions are isolated", () => {
    FileTracking.addGitModified("session-1", ["/path/to/file1.ts"])
    FileTracking.addGitModified("session-2", ["/path/to/file2.ts"])

    expect(FileTracking.isGitModified("session-1", "/path/to/file1.ts")).toBe(true)
    expect(FileTracking.isGitModified("session-1", "/path/to/file2.ts")).toBe(false)
    expect(FileTracking.isGitModified("session-2", "/path/to/file1.ts")).toBe(false)
    expect(FileTracking.isGitModified("session-2", "/path/to/file2.ts")).toBe(true)
  })

  test("addGitModified accumulates files across multiple calls", () => {
    FileTracking.addGitModified("test-session", ["/path/to/file1.ts"])
    FileTracking.addGitModified("test-session", ["/path/to/file2.ts"])
    FileTracking.addGitModified("test-session", ["/path/to/file3.ts"])

    const tracked = FileTracking.getGitModified("test-session")
    expect(tracked.size).toBe(3)
    expect(tracked.has("/path/to/file1.ts")).toBe(true)
    expect(tracked.has("/path/to/file2.ts")).toBe(true)
    expect(tracked.has("/path/to/file3.ts")).toBe(true)
  })

  test("addGitModified deduplicates files", () => {
    FileTracking.addGitModified("test-session", ["/path/to/file1.ts", "/path/to/file1.ts"])
    FileTracking.addGitModified("test-session", ["/path/to/file1.ts"])

    const tracked = FileTracking.getGitModified("test-session")
    expect(tracked.size).toBe(1)
  })
})
