import { describe, expect, it } from "bun:test"
import { SoulGuard } from "@/soul/guard"

describe("soul formation guard", () => {
  it("protects the soul file and its eval artifacts", () => {
    expect(SoulGuard.isProtectedEditTarget("SOUL.md")).toBe(true)
    expect(SoulGuard.isProtectedEditTarget("src/SOUL.md")).toBe(true)
    expect(SoulGuard.isProtectedEditTarget("SOUL.suite.yaml")).toBe(true)
    expect(SoulGuard.isProtectedEditTarget("evals/SOUL.baseline.json")).toBe(true)
  })

  it("does not protect ordinary files", () => {
    expect(SoulGuard.isProtectedEditTarget("notes.md")).toBe(false)
    expect(SoulGuard.isProtectedEditTarget("src/soul/guard.ts")).toBe(false)
    expect(SoulGuard.isProtectedEditTarget("SOUL.md.bak")).toBe(false)
  })

  it("does not let a broad glob match", () => {
    expect(SoulGuard.isProtectedEditTarget("*.md")).toBe(false)
    expect(SoulGuard.isProtectedEditTarget("**/*.md")).toBe(false)
  })

  it("matches targeted globs", () => {
    expect(SoulGuard.isProtectedEditTarget("**/SOUL.md")).toBe(true)
    expect(SoulGuard.isProtectedEditTarget("**/SOUL.suite.yaml")).toBe(true)
  })

  it("trusts the tool metadata filepath over the pattern", () => {
    expect(SoulGuard.isProtectedEditTarget("relative/path.md", "/work/SOUL.md")).toBe(true)
    expect(SoulGuard.isProtectedEditTarget("SOUL.md", "/work/notes.md")).toBe(true)
  })

  it("explains the legitimate path in the denial", () => {
    const msg = SoulGuard.denialMessage("SOUL.md")
    expect(msg).toContain("formation guard")
    expect(msg).toContain("SOUL.md")
    expect(msg).toContain("human edit")
  })
})
