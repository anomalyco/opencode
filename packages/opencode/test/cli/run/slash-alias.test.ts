import { describe, expect, it } from "bun:test"
import { getSlashAliases, resolveSlashAlias } from "@/cli/cmd/run/slash-alias"

describe("resolveSlashAlias", () => {
  it("resolves /clear to /new", () => {
    expect(resolveSlashAlias("clear")).toBe("new")
  })

  it("resolves /resume to /sessions", () => {
    expect(resolveSlashAlias("resume")).toBe("sessions")
  })

  it("resolves /continue to /sessions", () => {
    expect(resolveSlashAlias("continue")).toBe("sessions")
  })

  it("resolves /quit to /exit", () => {
    expect(resolveSlashAlias("quit")).toBe("exit")
  })

  it("resolves /q to /exit", () => {
    expect(resolveSlashAlias("q")).toBe("exit")
  })

  it("resolves /agents to /agents", () => {
    expect(resolveSlashAlias("agents")).toBe("agents")
  })

  it("returns undefined for non-alias", () => {
    expect(resolveSlashAlias("foobar")).toBe(undefined)
  })

  it("returns undefined for primary command name", () => {
    expect(resolveSlashAlias("new")).toBe(undefined)
    expect(resolveSlashAlias("exit")).toBe(undefined)
    expect(resolveSlashAlias("sessions")).toBe(undefined)
  })
})

describe("getSlashAliases", () => {
  it("returns aliases for new", () => {
    expect(getSlashAliases("new")).toContain("clear")
  })

  it("returns aliases for sessions", () => {
    const aliases = getSlashAliases("sessions")
    expect(aliases).toContain("resume")
    expect(aliases).toContain("continue")
  })

  it("returns aliases for exit", () => {
    const aliases = getSlashAliases("exit")
    expect(aliases).toContain("quit")
    expect(aliases).toContain("q")
  })

  it("returns empty array for primary-only commands", () => {
    expect(getSlashAliases("foobar")).toEqual([])
  })
})
