import { describe, it, expect } from "bun:test"
import { CommandResolver } from "../../src/command/resolver"
import type { CommandExecutionContext, CustomCommand } from "../../src/command/types"

describe("CommandResolver", () => {
  const resolver = new CommandResolver()

  const createContext = (rawContent: string, args: string = ""): CommandExecutionContext => ({
    command: {
      name: "test",
      path: "/test/command.md",
      scope: "project",
      metadata: {},
      rawContent,
    } as CustomCommand,
    arguments: args,
    sessionId: "test-session",
    messageId: "test-message",
    workingDirectory: "/test",
  })

  describe("argument validation", () => {
    it("should validate no arguments when none expected", async () => {
      const context = createContext("Simple command with no placeholders", "unexpected args")

      expect(resolver.resolve(context.command.rawContent, context)).rejects.toThrow(
        "Command 'test' does not accept arguments",
      )
    })

    it("should validate exact argument count", async () => {
      const context = createContext("Hello $ARGUMENTS and $ARGUMENTS!", "world")

      expect(resolver.resolve(context.command.rawContent, context)).rejects.toThrow(
        "Command 'test' expects exactly 2 arguments, but 1 was provided",
      )
    })

    it("should pass validation with correct argument count", async () => {
      const context = createContext("Hello $ARGUMENTS!", "world")
      const result = await resolver.resolve(context.command.rawContent, context)

      expect(result).toBe("Hello world!")
    })
  })

  describe("argument interpolation", () => {
    it("should replace $ARGUMENTS placeholders individually", async () => {
      const context = createContext("$ARGUMENTS says hello to $ARGUMENTS", "Alice Bob")
      const result = await resolver.resolve(context.command.rawContent, context)

      expect(result).toBe("Alice says hello to Bob")
    })

    it("should replace {{args}} placeholders individually", async () => {
      const context = createContext("{{args}} meets {{args}}", "John Jane")
      const result = await resolver.resolve(context.command.rawContent, context)

      expect(result).toBe("John meets Jane")
    })

    it("should handle mixed placeholder types", async () => {
      const context = createContext("$ARGUMENTS and {{args}} are friends", "Tom Jerry")
      const result = await resolver.resolve(context.command.rawContent, context)

      expect(result).toBe("Tom and Jerry are friends")
    })

    it("should handle multiple arguments correctly", async () => {
      const context = createContext("Command: $ARGUMENTS, Target: $ARGUMENTS, Message: $ARGUMENTS", "create user hello")
      const result = await resolver.resolve(context.command.rawContent, context)

      expect(result).toBe("Command: create, Target: user, Message: hello")
    })
  })

  describe("file reference resolution", () => {
    it("should handle missing files", async () => {
      const context = createContext("Content: @{nonexistent.txt}")
      const result = await resolver.resolve(context.command.rawContent, context)

      expect(result).toContain("[File not found: nonexistent.txt]")
    })
  })
})
