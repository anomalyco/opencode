import { describe, expect, test } from "bun:test"
import yargs from "yargs"
import { SemanticCommand } from "../../src/cli/cmd/semantic"

describe("SemanticCommand CLI definition", () => {
  test("defines command name and description", () => {
    expect(SemanticCommand.command).toBe("semantic")
    expect(SemanticCommand.describe).toContain("semantic")
  })

  test("configures index, status, and watch subcommands", async () => {
    const parser = yargs().command(SemanticCommand as any)
    const help = await new Promise<string>((resolve) => {
      parser.parse("semantic --help", (_err: any, _argv: any, output: string) => {
        resolve(output)
      })
    })

    expect(help).toContain("semantic index")
    expect(help).toContain("semantic status")
    expect(help).toContain("semantic watch")
  })
})
