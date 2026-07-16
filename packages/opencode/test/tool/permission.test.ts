import { describe, expect, it } from "bun:test"
import { alwaysPattern } from "../../src/tool/permission"

describe("alwaysPattern", () => {
  it("scopes to parent directory for file in subdirectory", () => {
    expect(alwaysPattern("src/tool/read.ts")).toEqual(["src/tool/*"])
  })

  it("uses wildcard for file at worktree root", () => {
    expect(alwaysPattern("package.json")).toEqual(["*"])
  })

  it("scopes to parent directory for external files via relative path", () => {
    expect(alwaysPattern("../../.config/opencode/config.json")).toEqual(["../../.config/opencode/*"])
  })

  it("handles deep nested subdirectory", () => {
    expect(alwaysPattern("a/b/c/d/file.txt")).toEqual(["a/b/c/d/*"])
  })

  it("handles single file in subdirectory without extension", () => {
    expect(alwaysPattern("bin/opencode")).toEqual(["bin/*"])
  })
})
