import { describe, expect, test, afterEach } from "bun:test"
import path from "path"
import { Personality } from "../../src/personality"
import { SystemPrompt } from "../../src/session/system"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { BUILTIN_PRESETS } from "../../src/personality/presets"

const MODEL = { api: { id: "claude-sonnet-4" }, providerID: "anthropic" } as any
const SESSION = "prompt-assembly-test"

afterEach(() => Personality.clearSession(SESSION))

describe("Tier 1 — Prompt assembly integration", () => {
  test("default assembly returns [soul, routing, env] with correct content", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parts = await SystemPrompt.environment(MODEL)
        expect(parts).toHaveLength(3)
        // Slot 0: soul identity
        expect(parts[0]).toContain("You are")
        // Slot 1: routing table
        expect(parts[1]).toContain("| User Intent")
        // Slot 2: env context
        expect(parts[2]).toContain("Working directory")
      },
    })
  })

  test("custom SOUL.md replaces default soul in slot 0", async () => {
    await using tmp = await tmpdir({ git: true })
    const cfg = path.join(tmp.path, "config")
    await Bun.write(path.join(cfg, "SOUL.md"), "You are a pirate coding assistant. Arrr.")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parts = await SystemPrompt.environment(MODEL, {
          soulConfigDir: cfg,
          projectDir: tmp.path,
        })
        expect(parts[0]).toContain("pirate coding assistant")
        expect(parts[0]).not.toContain("helpful, knowledgeable, and direct")
      },
    })
  })

  test("global + project SOUL.md are concatenated in slot 0", async () => {
    await using tmp = await tmpdir({ git: true })
    const cfg = path.join(tmp.path, "config")
    await Bun.write(path.join(cfg, "SOUL.md"), "Global identity layer.")
    await Bun.write(path.join(tmp.path, ".xcsh", "SOUL.md"), "Project identity layer.")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parts = await SystemPrompt.environment(MODEL, {
          soulConfigDir: cfg,
          projectDir: tmp.path,
        })
        expect(parts[0]).toContain("Global identity layer.")
        expect(parts[0]).toContain("Project identity layer.")
        expect(parts[0].indexOf("Global")).toBeLessThan(parts[0].indexOf("Project"))
      },
    })
  })

  test("personality overlay is separate from soul — they do not interfere", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        Personality.setSession(SESSION, "concise")

        // environment() still returns default soul, unaffected by personality
        const parts = await SystemPrompt.environment(MODEL)
        expect(parts[0]).toContain("You are")
        expect(parts[0]).not.toContain("concise")

        // getSessionPrompt() returns the personality overlay separately
        const overlay = await SystemPrompt.getSessionPrompt(SESSION, {})
        expect(overlay).toBeDefined()
        expect(overlay).toContain("concise")
      },
    })
  })

  test("personality with tone/style produces formatted output", async () => {
    Personality.setSession(SESSION, "styled")
    const config = {
      personality: {
        custom: {
          styled: {
            system_prompt: "You are a styled assistant.",
            tone: "warm",
            style: "bullet points",
          },
        },
      },
    }
    const overlay = await SystemPrompt.getSessionPrompt(SESSION, config)
    expect(overlay).toContain("You are a styled assistant.")
    expect(overlay).toContain("Tone: warm")
    expect(overlay).toContain("Style: bullet points")
  })

  test("clearing personality restores clean state", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        Personality.setSession(SESSION, "technical")
        Personality.clearSession(SESSION)

        const overlay = await SystemPrompt.getSessionPrompt(SESSION, {})
        expect(overlay).toBeUndefined()

        const parts = await SystemPrompt.environment(MODEL)
        expect(parts[0]).toContain("You are")
      },
    })
  })

  test("custom config personality overrides builtin of same name", async () => {
    Personality.setSession(SESSION, "concise")
    const config = {
      personality: {
        custom: { concise: "My custom concise personality." },
      },
    }
    const overlay = await SystemPrompt.getSessionPrompt(SESSION, config)
    expect(overlay).toBe("My custom concise personality.")
  })

  test("all 10 presets produce non-empty, distinct prompts", () => {
    const names = Object.keys(BUILTIN_PRESETS)
    expect(names).toHaveLength(10)

    const prompts = names.map((n) => {
      const info = Personality.resolve(n, {})
      expect(info).toBeDefined()
      expect(info!.system_prompt.trim().length).toBeGreaterThan(0)
      return info!.system_prompt
    })

    const unique = new Set(prompts)
    expect(unique.size).toBe(10)
  })
})
