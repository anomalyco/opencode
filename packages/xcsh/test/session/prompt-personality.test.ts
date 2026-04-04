import { describe, expect, test, afterEach } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { SystemPrompt } from "../../src/session/system"
import { Personality } from "../../src/personality"
import { tmpdir } from "../fixture/fixture"

const SESSION = "prompt-personality-test"

afterEach(() => Personality.clearSession(SESSION))

describe("SystemPrompt.environment — personality integration", () => {
  test("environment() slot 0 is soul identity (not routing)", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const model = { api: { id: "claude-sonnet-4" }, providerID: "anthropic" } as any
        const parts = await SystemPrompt.environment(model)
        expect(parts[0]).toContain("You are")
        expect(parts[0]).not.toContain("| User Intent")
      },
    })
  })

  test("environment() slot 1 is the routing table", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const model = { api: { id: "claude-sonnet-4" }, providerID: "anthropic" } as any
        const parts = await SystemPrompt.environment(model)
        expect(parts[1]).toContain("| User Intent")
        expect(parts[1]).toContain("Skill Domain")
      },
    })
  })

  test("getSessionPrompt returns undefined when no personality active", async () => {
    const prompt = await SystemPrompt.getSessionPrompt(SESSION, {})
    expect(prompt).toBeUndefined()
  })

  test("getSessionPrompt returns personality system_prompt when session personality is set", async () => {
    Personality.setSession(SESSION, "concise")
    const prompt = await SystemPrompt.getSessionPrompt(SESSION, {})
    expect(prompt).toBeDefined()
    expect(prompt).toContain("concise")
  })

  test("getSessionPrompt returns undefined after clearing session", async () => {
    Personality.setSession(SESSION, "technical")
    Personality.clearSession(SESSION)
    const prompt = await SystemPrompt.getSessionPrompt(SESSION, {})
    expect(prompt).toBeUndefined()
  })

  test("getSessionPrompt resolves custom personality system_prompt", async () => {
    Personality.setSession(SESSION, "mybot")
    const config = {
      personality: {
        custom: { mybot: { system_prompt: "You are MyBot." } },
      },
    }
    const prompt = await SystemPrompt.getSessionPrompt(SESSION, config)
    expect(prompt).toBe("You are MyBot.")
  })

  test("custom SOUL.md content is used as slot 0 when present", async () => {
    await using tmp = await tmpdir({ git: true })
    const configDir = path.join(tmp.path, "config")
    await Bun.write(path.join(configDir, "SOUL.md"), "You are a custom identity.")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const model = { api: { id: "claude-sonnet-4" }, providerID: "anthropic" } as any
        const parts = await SystemPrompt.environment(model, {
          soulConfigDir: configDir,
          projectDir: tmp.path,
        })
        expect(parts[0]).toContain("You are a custom identity.")
      },
    })
  })
})
