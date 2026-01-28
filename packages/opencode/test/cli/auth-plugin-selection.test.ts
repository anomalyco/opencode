import { test, expect } from "bun:test"
import type { Hooks } from "@opencode-ai/plugin"

const plugins = [
  {
    auth: {
      provider: "openai",
      methods: [{ type: "api", label: "First" }],
    },
  },
  {
    auth: {
      provider: "openai",
      methods: [{ type: "api", label: "Second" }],
    },
  },
] satisfies Hooks[]

test("authPlugin picks last auth provider", async () => {
  const mod = await import("../../src/cli/cmd/auth")
  const pick = (mod as Record<string, unknown>).authPlugin as
    | ((items: Hooks[], provider: string) => Hooks["auth"] | undefined)
    | undefined

  const result = pick?.(plugins, "openai")
  expect(result).toBe(plugins[1].auth)
})

test("authPlugin returns undefined when missing", async () => {
  const mod = await import("../../src/cli/cmd/auth")
  const pick = (mod as Record<string, unknown>).authPlugin as
    | ((items: Hooks[], provider: string) => Hooks["auth"] | undefined)
    | undefined

  const result = pick?.(plugins, "anthropic")
  expect(result).toBeUndefined()
})
