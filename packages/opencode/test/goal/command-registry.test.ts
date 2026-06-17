import { describe, expect, test } from "bun:test"
import { Command } from "@/command"

describe("native goal command registry", () => {
  test("default commands include native goal", () => {
    expect(Command.Default.GOAL).toBe("goal")
  })
})
