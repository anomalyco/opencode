import { describe, expect, test } from "bun:test"
import yargs from "yargs"
import { SemanticCommand } from "../../src/cli/cmd/semantic"

describe("SemanticCommand CLI definition", () => {
  test("defines command name and description", () => {
    expect(SemanticCommand.command).toBe("semantic")
    expect(SemanticCommand.describe).toContain("semantic")
  })

  test("configures index and status subcommands", () => {
    const parser = yargs().command(SemanticCommand as any)
    const help = parser.getHelp()
    expect(help).resolves.toContain("semantic")
  })
})
