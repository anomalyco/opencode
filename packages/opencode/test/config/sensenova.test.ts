import { describe, expect, test } from "bun:test"
import { ConfigSensenova } from "@/config/sensenova"

describe("SenseNova compaction defaults", () => {
  test("writes a secret-free default config", () => {
    const config = ConfigSensenova.defaultConfig()

    expect(config.provider?.sensenova?.env).toEqual([ConfigSensenova.API_KEY_ENV])
    expect(config.provider?.sensenova?.options).toBeUndefined()
    expect(config.agent).toBeUndefined()
    expect(JSON.stringify(config)).not.toContain("apiKey")
  })

  test("does not select SenseNova for compaction without credentials", () => {
    const config = ConfigSensenova.applyDefaults(ConfigSensenova.defaultConfig(), {})

    expect(config.provider?.sensenova).toBeDefined()
    expect(config.agent?.compaction).toBeUndefined()
  })

  test("does not change configuration when the provider is not configured", () => {
    const config = { username: "test" }
    expect(ConfigSensenova.applyDefaults(config, {})).toEqual(config)
  })

  test("configures DeepSeek V4 Flash with maximum reasoning by default", () => {
    const config = ConfigSensenova.applyDefaults({}, { SENSENOVA_API_KEY: "test-key" })

    expect(config.provider?.sensenova?.api).toBe(ConfigSensenova.API_URL)
    expect(config.provider?.sensenova?.env).toEqual([ConfigSensenova.API_KEY_ENV])
    expect(config.provider?.sensenova?.models?.[ConfigSensenova.DEEPSEEK_MODEL]?.variants?.max).toEqual({
      reasoningEffort: "max",
    })
    expect(config.agent?.compaction).toMatchObject({
      model: `sensenova/${ConfigSensenova.DEEPSEEK_MODEL}`,
      variant: "max",
      options: { reasoningEffort: "max" },
    })
  })

  test("allows SenseNova Flash-Lite as the compaction model", () => {
    const config = ConfigSensenova.applyDefaults(
      {},
      {
        SENSENOVA_API_KEY: "test-key",
        OPENCODE_COMPACTION_MODEL: ConfigSensenova.SENSENOVA_MODEL,
      },
    )

    expect(config.agent?.compaction).toMatchObject({
      model: `sensenova/${ConfigSensenova.SENSENOVA_MODEL}`,
      variant: "high",
      options: { reasoningEffort: "high" },
    })
  })

  test("preserves an explicitly configured compaction agent", () => {
    const compaction = { model: "openai/gpt-5-mini", prompt: "custom" }
    const config = ConfigSensenova.applyDefaults({ agent: { compaction } }, { SENSENOVA_API_KEY: "test-key" })

    expect(config.agent?.compaction).toEqual(compaction)
    expect(config.provider?.sensenova).toBeDefined()
  })
})
