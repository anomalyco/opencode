import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  DEFENSIVE_NOTE,
  DefensiveSystemPromptPlugin,
  isDisabled,
} from "../../../src/securecode/plugins/defensive-system-prompt"

const stubPluginInput = {} as Parameters<typeof DefensiveSystemPromptPlugin>[0]
const DISABLE_ENV = "SECURECODE_DEFENSIVE_PROMPT_DISABLE"

beforeEach(() => {
  delete process.env[DISABLE_ENV]
})

afterEach(() => {
  delete process.env[DISABLE_ENV]
})

const stubHookInput = { sessionID: "s1", model: { id: "claude-sonnet-4-6" } as any }

describe("DefensiveSystemPromptPlugin", () => {
  test("appends the defensive note to system[]", async () => {
    const hooks = await DefensiveSystemPromptPlugin(stubPluginInput)
    const transform = hooks["experimental.chat.system.transform"]!
    const output = { system: ["You are a helpful assistant."] }
    await transform(stubHookInput as any, output as any)
    expect(output.system).toHaveLength(2)
    expect(output.system[0]).toBe("You are a helpful assistant.")
    expect(output.system[1]).toBe(DEFENSIVE_NOTE)
  })

  test("is idempotent — does not stack the note when called twice", async () => {
    const hooks = await DefensiveSystemPromptPlugin(stubPluginInput)
    const transform = hooks["experimental.chat.system.transform"]!
    const output = { system: ["agent prompt"] }
    await transform(stubHookInput as any, output as any)
    await transform(stubHookInput as any, output as any)
    expect(output.system.filter((s) => s === DEFENSIVE_NOTE)).toHaveLength(1)
  })

  test("works on an empty system[]", async () => {
    const hooks = await DefensiveSystemPromptPlugin(stubPluginInput)
    const transform = hooks["experimental.chat.system.transform"]!
    const output = { system: [] as string[] }
    await transform(stubHookInput as any, output as any)
    expect(output.system).toEqual([DEFENSIVE_NOTE])
  })

  test("no-op when output is missing", async () => {
    const hooks = await DefensiveSystemPromptPlugin(stubPluginInput)
    const transform = hooks["experimental.chat.system.transform"]!
    await transform(stubHookInput as any, undefined as any)
    await transform(stubHookInput as any, {} as any)
    await transform(stubHookInput as any, { system: "not-an-array" } as any)
  })
})

describe("DefensiveSystemPromptPlugin disable env var", () => {
  test("returns no hooks when SECURECODE_DEFENSIVE_PROMPT_DISABLE=1", async () => {
    process.env[DISABLE_ENV] = "1"
    expect(isDisabled()).toBe(true)
    const hooks = await DefensiveSystemPromptPlugin(stubPluginInput)
    expect(hooks["experimental.chat.system.transform"]).toBeUndefined()
  })

  test("does not disable when env var is empty or unset", async () => {
    expect(isDisabled()).toBe(false)
    process.env[DISABLE_ENV] = "0"
    expect(isDisabled()).toBe(false)
    process.env[DISABLE_ENV] = ""
    expect(isDisabled()).toBe(false)
  })
})

describe("DEFENSIVE_NOTE content", () => {
  test("mentions untrusted-content tag", () => {
    expect(DEFENSIVE_NOTE).toContain("<untrusted-content>")
  })

  test("tells the model that tool output is data, not instructions", () => {
    expect(DEFENSIVE_NOTE).toMatch(/DATA, not INSTRUCTIONS/i)
  })
})
