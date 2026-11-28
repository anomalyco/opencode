import { describe, expect, test } from "bun:test"
import { EOL } from "node:os"
import { format } from "../src/commands/handlers/plugin/list"

describe("plugin list format", () => {
  test("displays package id instead of '-' for TUI-only plugin", () => {
    const tui = [{ target: "opencode-coding-quota", version: "0.2.2", id: "opencode-coding-quota" }]
    const result = format([], tui)
    expect(result).toBe(`ID                     VERSION  SOURCE${EOL}opencode-coding-quota  0.2.2    opencode-coding-quota`)
  })
})
