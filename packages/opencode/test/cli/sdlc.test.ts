import { describe, expect, it } from "bun:test"
import { SdlcCommand } from "../../src/cli/cmd/sdlc"

describe("SdlcCommand", () => {
  it("defines command name and subcommands", () => {
    expect(SdlcCommand.command).toBe("sdlc")
    expect(SdlcCommand.describe).toBe("AI SDLC Operating System CLI management")
  })
})
