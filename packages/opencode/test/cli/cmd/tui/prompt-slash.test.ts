import { describe, expect, test } from "bun:test"
import { getLocalSlashCommand } from "../../../../src/cli/cmd/tui/component/prompt/slash"

describe("getLocalSlashCommand", () => {
  test("returns a standalone local slash command name", () => {
    expect(getLocalSlashCommand("  /spec  ", (name) => name === "spec")).toBe("spec")
  })

  test("does not intercept unknown standalone slash commands", () => {
    expect(getLocalSlashCommand("/review", () => false)).toBeUndefined()
  })

  test("does not intercept slash commands with arguments or multiline content", () => {
    const hasSlash = () => true

    expect(getLocalSlashCommand("/spec draft", hasSlash)).toBeUndefined()
    expect(getLocalSlashCommand("/spec\ndraft", hasSlash)).toBeUndefined()
  })

  test("does not intercept bare slashes or regular text", () => {
    const hasSlash = () => true

    expect(getLocalSlashCommand("/", hasSlash)).toBeUndefined()
    expect(getLocalSlashCommand("spec", hasSlash)).toBeUndefined()
  })
})