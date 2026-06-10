import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Command } from "@opencode-ai/opencode/command"
import { testEffect } from "./lib/effect"

const it = testEffect(Command.defaultLayer)

describe("Goal Command", () => {
  it.effect("goal command is registered", () =>
    Effect.gen(function* () {
      const command = yield* Command.Service
      const goalCmd = yield* command.get("goal")
      expect(goalCmd).toBeDefined()
      expect(goalCmd?.name).toBe("goal")
      expect(goalCmd?.description).toContain("goal")
    }),
  )

  it.effect("goal command has correct source", () =>
    Effect.gen(function* () {
      const command = yield* Command.Service
      const goalCmd = yield* command.get("goal")
      expect(goalCmd?.source).toBe("command")
    }),
  )

  it.effect("goal command is listed", () =>
    Effect.gen(function* () {
      const command = yield* Command.Service
      const commands = yield* command.list()
      const goalCmd = commands.find((c) => c.name === "goal")
      expect(goalCmd).toBeDefined()
    }),
  )
})
