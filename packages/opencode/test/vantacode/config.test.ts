import { describe, expect, test } from "bun:test"
import { mergeConfig, resolveKeys, resolveProviders, selectProvider } from "@/vantacode/config"

describe("resolveKeys (multi-key .env parsing — spec 3.6)", () => {
  test("single key", () => {
    expect(resolveKeys("OPENAI_API_KEY", { OPENAI_API_KEY: "sk-a" })).toEqual(["sk-a"])
  })

  test("comma-separated multi-key in one variable", () => {
    expect(resolveKeys("OPENAI_API_KEY", { OPENAI_API_KEY: "sk-a,sk-b,sk-c" })).toEqual(["sk-a", "sk-b", "sk-c"])
  })

  test("trims whitespace around each key", () => {
    expect(resolveKeys("OPENAI_API_KEY", { OPENAI_API_KEY: " sk-a , sk-b ,sk-c " })).toEqual(["sk-a", "sk-b", "sk-c"])
  })

  test("merges the plural *_KEYS form and dedupes", () => {
    expect(resolveKeys("OPENAI_API_KEY", { OPENAI_API_KEY: "sk-a", OPENAI_API_KEYS: "sk-a,sk-b" })).toEqual([
      "sk-a",
      "sk-b",
    ])
  })

  test("returns empty when env var is absent", () => {
    expect(resolveKeys("OPENAI_API_KEY", {})).toEqual([])
  })

  test("returns empty when apiKeyEnv is undefined", () => {
    expect(resolveKeys(undefined, { OPENAI_API_KEY: "sk-a" })).toEqual([])
  })

  test("ignores empty segments from trailing commas", () => {
    expect(resolveKeys("OPENAI_API_KEY", { OPENAI_API_KEY: "sk-a,,sk-b," })).toEqual(["sk-a", "sk-b"])
  })
})

describe("resolveProviders", () => {
  test("includes the keyless ollama preset by default", () => {
    const providers = resolveProviders({ env: {} })
    const ollama = providers.find((p) => p.id === "ollama")
    expect(ollama).toBeDefined()
    expect(ollama?.requiresKey).toBe(false)
  })

  test("resolves multiple keys onto an API provider", () => {
    const providers = resolveProviders({ env: { OPENAI_API_KEY: "sk-a,sk-b" } })
    const openai = providers.find((p) => p.id === "openai")
    expect(openai?.apiKeys).toEqual(["sk-a", "sk-b"])
  })

  test("honors a file-provided provider list", () => {
    const providers = resolveProviders({
      env: { GROQ_API_KEY: "gk-1" },
      file: { providers: [{ id: "groq" }] },
    })
    expect(providers).toHaveLength(1)
    expect(providers[0].id).toBe("groq")
    expect(providers[0].apiKeys).toEqual(["gk-1"])
  })
})

describe("mergeConfig", () => {
  test("env overrides pick default provider/model and debug", () => {
    const cfg = mergeConfig({ env: { VANTACODE_PROVIDER: "openai", VANTACODE_MODEL: "gpt-4o", VANTACODE_DEBUG: "1" } })
    expect(cfg.defaultProvider).toBe("openai")
    expect(cfg.defaultModel).toBe("gpt-4o")
    expect(cfg.debug).toBe(true)
  })

  test("OLLAMA_DEBUG=1 also enables debug", () => {
    expect(mergeConfig({ env: { OLLAMA_DEBUG: "1" } }).debug).toBe(true)
  })

  test("defaults to ollama provider when nothing is set", () => {
    expect(mergeConfig({ env: {} }).defaultProvider).toBe("ollama")
  })

  test("permission mode comes from env when present", () => {
    expect(mergeConfig({ env: { VANTACODE_PERMISSION: "yolo" } }).permissionMode).toBe("yolo")
  })
})

describe("selectProvider", () => {
  test("selects an explicitly requested provider", () => {
    const cfg = mergeConfig({ env: { OPENAI_API_KEY: "sk-a" } })
    expect(selectProvider(cfg, "openai")?.id).toBe("openai")
  })

  test("falls back to the default provider when id is unknown/absent", () => {
    const cfg = mergeConfig({ env: {} })
    expect(selectProvider(cfg)?.id).toBe("ollama")
  })

  test("falls back to first available keyless/keyed provider when default missing", () => {
    const cfg = mergeConfig({ env: { VANTACODE_PROVIDER: "does-not-exist" } })
    const chosen = selectProvider(cfg)
    expect(chosen).toBeDefined()
    // ollama is keyless so it is always available as a fallback
    expect(chosen?.requiresKey === false || (chosen?.apiKeys?.length ?? 0) > 0).toBe(true)
  })
})
