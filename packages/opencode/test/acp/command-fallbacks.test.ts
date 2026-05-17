import { describe, expect, test } from "bun:test"
import { ACP } from "../../src/acp/agent"

describe("acp command fallbacks", () => {
  test("registers built-in session commands when they are missing", () => {
    const commands: ACP.CommandOption[] = []

    ACP.addCommandFallbacks(commands)

    expect(commands.map((command) => command.name)).toEqual(["compact", "model", "mode"])
  })

  test("does not duplicate commands returned by the server", () => {
    const commands: ACP.CommandOption[] = [{ name: "model", description: "custom model command" }]

    ACP.addCommandFallbacks(commands)

    expect(commands.filter((command) => command.name === "model")).toHaveLength(1)
    expect(commands.map((command) => command.name)).toEqual(["model", "compact", "mode"])
  })
})
