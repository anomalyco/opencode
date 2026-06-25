import { describe, expect, test } from "bun:test"
import { resolvePromptSlashCommand } from "../../src/component/prompt/slash-command"

describe("prompt slash command parsing", () => {
  const commands = [{ name: "review" }, { name: "skills" }]

  test("ignores a bare slash", () => {
    expect(resolvePromptSlashCommand("/", commands)).toBeUndefined()
  })

  test("ignores empty command names even if a command snapshot is malformed", () => {
    expect(resolvePromptSlashCommand("/", [{ name: "" }])).toBeUndefined()
  })

  test("parses known slash command arguments", () => {
    expect(resolvePromptSlashCommand("/review branch", commands)).toEqual({
      name: "review",
      arguments: "branch",
    })
  })

  test("preserves multiline command arguments", () => {
    expect(resolvePromptSlashCommand("/review branch\ninclude logs", commands)).toEqual({
      name: "review",
      arguments: "branch\ninclude logs",
    })
  })

  test("ignores unknown slash commands", () => {
    expect(resolvePromptSlashCommand("/missing", commands)).toBeUndefined()
  })
})
