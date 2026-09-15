import { describe, expect, it } from "bun:test"
import { isTransientGitError } from "../../src/snapshot"

describe("isTransientGitError", () => {
  const cases: Array<[string, boolean]> = [
    ["error launching git: The paging file is too small for this operation to complete.", true],
    ["fatal: Out of memory, malloc failed (tried to allocate 1048576 bytes)", true],
    ["fatal: Out of memory, (tried to allocate 4241 wchar_t's)", true],
    ["error launching git: resource temporarily unavailable", true],
    ["spawn ENOMEM", true],
    ["cannot allocate memory", true],
    ["fatal: not a git repository", false],
    ["error: pathspec 'foo' did not match any file(s) known to git", false],
    ["", false],
  ]

  for (const [stderr, expected] of cases) {
    it(`"${stderr.slice(0, 40)}..." -> ${expected}`, () => {
      expect(isTransientGitError(stderr)).toBe(expected)
    })
  }
})
