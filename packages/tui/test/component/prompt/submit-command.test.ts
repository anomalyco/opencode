import { describe, expect, test } from "bun:test"
import { parsePromptSlashCommand } from "../../../src/component/prompt/submit-command"

describe("parsePromptSlashCommand", () => {
  test("does not treat a bare slash as an empty command", () => {
    expect(parsePromptSlashCommand("/", [{ name: "" }])).toBeUndefined()
  })

  test("parses known slash commands and preserves multiline arguments", () => {
    expect(parsePromptSlashCommand("/init one two\nrest", [{ name: "init" }])).toEqual({
      command: "init",
      arguments: "one two\nrest",
    })
  })

  test("ignores unknown slash commands", () => {
    expect(parsePromptSlashCommand("/missing", [{ name: "init" }])).toBeUndefined()
  })
})
