import { describe, expect, it } from "bun:test"
import { alwaysPattern } from "../../src/tool/permission"

function seededRandom(seed: number) {
  let s = seed | 0
  return () => {
    s = (Math.imul(s, 1103515245) + 12345) | 0
    return (s >>> 0) / 4294967296
  }
}

const chars = "abcdefghijklmnopqrstuvwxyz0123456789._-"

function randomPath(rng: () => number): string {
  const depth = rng() < 0.3 ? Math.floor(rng() * 4) + 1 : 1
  const parts: string[] = []
  if (rng() < 0.2) parts.push("..", "..", ".config")
  for (let i = 0; i < depth; i++) {
    const len = Math.floor(rng() * 12) + 1
    let s = ""
    for (let j = 0; j < len; j++) s += chars[Math.floor(rng() * chars.length)]
    parts.push(s)
  }
  return parts.join("/")
}

describe("alwaysPattern", () => {
  it("scopes to parent directory for file in subdirectory", () => {
    expect(alwaysPattern("src/tool/read.ts")).toEqual(["src/tool/*"])
  })

  it("scopes to current directory for file at worktree root", () => {
    expect(alwaysPattern("package.json")).toEqual(["./*"])
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

  it("never produces bare '*' wildcard for any path", () => {
    const rng = seededRandom(42)
    const paths = [
      "package.json",
      "src/tool/read.ts",
      "a/b/c.txt",
      "../../.config/file",
      "readme.md",
      ".",
      "",
      ...Array.from({ length: 100 }, () => randomPath(rng)),
    ]
    for (const p of paths) {
      const result = alwaysPattern(p)
      for (const pattern of result) {
        expect(pattern).not.toBe("*")
      }
    }
  })
})
