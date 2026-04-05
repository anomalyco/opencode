import { describe, expect, test } from "bun:test"
import { resolveLinkedPath } from "./message-link-path"

describe("resolveLinkedPath", () => {
  test("keeps exact project-relative matches", () => {
    expect(resolveLinkedPath("data/file.json", ["data/file.json"])).toBe("data/file.json")
  })

  test("prefers suffix matches for task-relative links", () => {
    expect(
      resolveLinkedPath("scripts/run.py", [
        ".trellis/tasks/04-04-foo/scripts/run.py",
        ".trellis/tasks/04-04-bar/scripts/run.py",
      ]),
    ).toBe(".trellis/tasks/04-04-foo/scripts/run.py")
  })

  test("falls back to filename matches", () => {
    expect(
      resolveLinkedPath("scripts/run.py", [
        ".trellis/tasks/04-04-foo/data/run.json",
        ".trellis/tasks/04-04-foo/scripts/run.py",
      ]),
    ).toBe(".trellis/tasks/04-04-foo/scripts/run.py")
  })

  test("returns input when nothing matches", () => {
    expect(resolveLinkedPath("scripts/run.py", ["data/file.json"])).toBe("scripts/run.py")
  })

  test("does not escape project search results", () => {
    expect(
      resolveLinkedPath("scripts/run.py", [
        ".trellis/tasks/04-04-foo/scripts/run.py",
        "Notes/run.py",
      ]),
    ).toBe(".trellis/tasks/04-04-foo/scripts/run.py")
  })
})
