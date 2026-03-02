import { test, expect, describe } from "bun:test"
import path from "path"
import { unlink } from "fs/promises"

import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider/provider"
import { Env } from "../../src/env"
import { Global } from "../../src/global"
import { Filesystem } from "../../src/util/filesystem"

const CLAUDE_MODELS = [
  "claude-sonnet-4-6", "claude-opus-4-6", "claude-sonnet-4-5",
  "claude-opus-4", "claude-sonnet-4", "claude-haiku-4-5",
]
const OPENAI_MODELS = [
  "gpt-5", "gpt-o4-mini", "gpt-o3", "gpt-4o",
  "google-gemini-2.5-pro", "google-gemini-2.5-flash", "xai-grok",
]
const ALL_MODELS = [...CLAUDE_MODELS, ...OPENAI_MODELS]

function withAsksage(fn: () => Promise<void>) {
  return async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Filesystem.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({ $schema: "https://opencode.ai/config.json" }),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      init: async () => { Env.set("ASKSAGE_API_KEY", "test-asksage-key") },
      fn,
    })
  }
}

test("AskSage: provider loaded from ASKSAGE_API_KEY env var", withAsksage(async () => {
  const providers = await Provider.list()
  expect(providers["asksage"]).toBeDefined()
  expect(providers["asksage"].source).toBe("env")
}))

test("AskSage: provider NOT loaded when no credentials present", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Filesystem.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({ $schema: "https://opencode.ai/config.json" }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    init: async () => { Env.set("ASKSAGE_API_KEY", "") },
    fn: async () => {
      const providers = await Provider.list()
      expect(providers["asksage"]).toBeUndefined()
    },
  })
})

test("AskSage: provider loaded from config with apiKey option", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Filesystem.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          provider: { asksage: { options: { apiKey: "config-asksage-key" } } },
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const providers = await Provider.list()
      expect(providers["asksage"]).toBeDefined()
      expect(providers["asksage"].source).toBe("config")
    },
  })
})

test("AskSage: loads when bearer token from auth.json is present", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Filesystem.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({ $schema: "https://opencode.ai/config.json" }),
      )
    },
  })
  const authPath = path.join(Global.Path.data, "auth.json")
  let originalAuth: string | undefined
  try { originalAuth = await Filesystem.readText(authPath) } catch {}
  try {
    await Filesystem.write(authPath, JSON.stringify({
      asksage: { type: "api", key: "auth-json-asksage-key" },
    }))
    await Instance.provide({
      directory: tmp.path,
      init: async () => { Env.set("ASKSAGE_API_KEY", "") },
      fn: async () => {
        const providers = await Provider.list()
        expect(providers["asksage"]).toBeDefined()
        expect(providers["asksage"].source).toBe("api")
      },
    })
  } finally {
    if (originalAuth !== undefined) {
      await Filesystem.write(authPath, originalAuth)
    } else {
      try { await unlink(authPath) } catch {}
    }
  }
})

test("AskSage: lists all expected models", withAsksage(async () => {
  const providers = await Provider.list()
  const models = Object.keys(providers["asksage"].models)
  for (const id of ALL_MODELS) {
    expect(models).toContain(id)
  }
  expect(models.length).toBe(ALL_MODELS.length)
}))

test("AskSage: Claude models use @ai-sdk/anthropic, others use @ai-sdk/openai-compatible", withAsksage(async () => {
  const providers = await Provider.list()
  const models = providers["asksage"].models
  for (const id of CLAUDE_MODELS) {
    expect(models[id].api.npm).toBe("@ai-sdk/anthropic")
    expect(models[id].api.url).toBe("https://api.asksage.ai/server/anthropic/v1")
  }
  for (const id of OPENAI_MODELS) {
    expect(models[id].api.npm).toBe("@ai-sdk/openai-compatible")
    expect(models[id].api.url).toBe("https://api.asksage.ai/server/openai/v1")
  }
}))

describe("AskSage: model capabilities", () => {
  test("Claude models have correct capabilities", withAsksage(async () => {
    const providers = await Provider.list()
    const model = providers["asksage"].models["claude-sonnet-4-6"]
    expect(model.capabilities.reasoning).toBe(true)
    expect(model.capabilities.toolcall).toBe(true)
    expect(model.capabilities.attachment).toBe(true)
    expect(model.capabilities.temperature).toBe(false)
    expect(model.capabilities.input.text).toBe(true)
    expect(model.capabilities.input.image).toBe(true)
    expect(model.capabilities.input.pdf).toBe(true)
    expect(model.capabilities.output.text).toBe(true)
  }))

  test("claude-haiku-4-5 has reasoning disabled", withAsksage(async () => {
    const providers = await Provider.list()
    const model = providers["asksage"].models["claude-haiku-4-5"]
    expect(model.capabilities.reasoning).toBe(false)
    expect(model.capabilities.toolcall).toBe(true)
  }))

  test("GPT and Gemini models have temperature enabled", withAsksage(async () => {
    const providers = await Provider.list()
    for (const id of OPENAI_MODELS) {
      expect(providers["asksage"].models[id].capabilities.temperature).toBe(true)
    }
  }))

  test("gpt-5 has reasoning enabled", withAsksage(async () => {
    const providers = await Provider.list()
    const model = providers["asksage"].models["gpt-5"]
    expect(model.capabilities.reasoning).toBe(true)
    expect(model.capabilities.toolcall).toBe(true)
    expect(model.api.id).toBe("gpt-5")
  }))
})

describe("AskSage: model limits and costs", () => {
  test("claude-sonnet-4-6 has correct limits", withAsksage(async () => {
    const providers = await Provider.list()
    const model = providers["asksage"].models["claude-sonnet-4-6"]
    expect(model.limit.context).toBe(200000)
    expect(model.limit.output).toBe(16384)
  }))

  test("claude-haiku-4-5 has smaller output limit", withAsksage(async () => {
    const providers = await Provider.list()
    const model = providers["asksage"].models["claude-haiku-4-5"]
    expect(model.limit.context).toBe(200000)
    expect(model.limit.output).toBe(8192)
  }))

  test("opus models have higher cost than sonnet models", withAsksage(async () => {
    const providers = await Provider.list()
    const opus = providers["asksage"].models["claude-opus-4-6"]
    const sonnet = providers["asksage"].models["claude-sonnet-4-6"]
    expect(opus.cost.input).toBeGreaterThan(sonnet.cost.input)
    expect(opus.cost.output).toBeGreaterThan(sonnet.cost.output)
  }))

  test("gemini models have large context windows", withAsksage(async () => {
    const providers = await Provider.list()
    const gemini = providers["asksage"].models["google-gemini-2.5-pro"]
    expect(gemini.limit.context).toBe(1048576)
  }))
})

test("AskSage: Claude models have anthropic-beta headers", withAsksage(async () => {
  const providers = await Provider.list()
  for (const id of CLAUDE_MODELS) {
    const model = providers["asksage"].models[id]
    expect(model.headers["anthropic-beta"]).toContain("claude-code-20250219")
  }
  // OpenAI models should NOT have anthropic-beta headers
  for (const id of OPENAI_MODELS) {
    const model = providers["asksage"].models[id]
    expect(model.headers["anthropic-beta"]).toBeUndefined()
  }
}))

test("AskSage: custom baseURL via config for government instances", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Filesystem.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          provider: {
            asksage: { options: { baseURL: "https://api.genai.army.mil/server/anthropic/v1" } },
          },
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    init: async () => { Env.set("ASKSAGE_API_KEY", "test-asksage-key") },
    fn: async () => {
      const providers = await Provider.list()
      expect(providers["asksage"]).toBeDefined()
      expect(providers["asksage"].options?.baseURL).toBe("https://api.genai.army.mil/server/anthropic/v1")
    },
  })
})

test("AskSage: disabled_providers excludes asksage", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Filesystem.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({ $schema: "https://opencode.ai/config.json", disabled_providers: ["asksage"] }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    init: async () => { Env.set("ASKSAGE_API_KEY", "test-asksage-key") },
    fn: async () => {
      const providers = await Provider.list()
      expect(providers["asksage"]).toBeUndefined()
    },
  })
})

test("AskSage: enabled_providers restricts to only asksage", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Filesystem.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({ $schema: "https://opencode.ai/config.json", enabled_providers: ["asksage"] }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    init: async () => {
      Env.set("ASKSAGE_API_KEY", "test-asksage-key")
      Env.set("ANTHROPIC_API_KEY", "test-anthropic-key")
    },
    fn: async () => {
      const providers = await Provider.list()
      expect(providers["asksage"]).toBeDefined()
      expect(providers["anthropic"]).toBeUndefined()
    },
  })
})

test("AskSage: model whitelist filters models", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Filesystem.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          provider: { asksage: { whitelist: ["claude-sonnet-4-6", "gpt-5"] } },
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    init: async () => { Env.set("ASKSAGE_API_KEY", "test-asksage-key") },
    fn: async () => {
      const providers = await Provider.list()
      const models = Object.keys(providers["asksage"].models)
      expect(models).toContain("claude-sonnet-4-6")
      expect(models).toContain("gpt-5")
      expect(models.length).toBe(2)
    },
  })
})

test("AskSage: model blacklist excludes specific models", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Filesystem.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          provider: { asksage: { blacklist: ["claude-haiku-4-5", "xai-grok"] } },
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    init: async () => { Env.set("ASKSAGE_API_KEY", "test-asksage-key") },
    fn: async () => {
      const providers = await Provider.list()
      const models = Object.keys(providers["asksage"].models)
      expect(models).not.toContain("claude-haiku-4-5")
      expect(models).not.toContain("xai-grok")
      expect(models).toContain("claude-sonnet-4-6")
      expect(models).toContain("gpt-5")
    },
  })
})

test("AskSage: provider env array contains ASKSAGE_API_KEY", withAsksage(async () => {
  const providers = await Provider.list()
  expect(providers["asksage"].env).toContain("ASKSAGE_API_KEY")
}))

test("AskSage: all models have providerID set to asksage", withAsksage(async () => {
  const providers = await Provider.list()
  for (const model of Object.values(providers["asksage"].models)) {
    expect(model.providerID).toBe("asksage")
  }
}))

test("AskSage: reasoning models have thinking variants", withAsksage(async () => {
  const providers = await Provider.list()
  const sonnet46 = providers["asksage"].models["claude-sonnet-4-6"]
  expect(sonnet46.capabilities.reasoning).toBe(true)
  expect(Object.keys(sonnet46.variants!).length).toBeGreaterThan(0)

  const haiku = providers["asksage"].models["claude-haiku-4-5"]
  expect(haiku.capabilities.reasoning).toBe(false)
  expect(Object.keys(haiku.variants ?? {}).length).toBe(0)
}))

test("AskSage: custom model added via config merges with database models", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Filesystem.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          provider: {
            asksage: {
              models: {
                "custom-model": { id: "claude-sonnet-4-6-20250923", name: "My Custom AskSage Model" },
              },
            },
          },
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    init: async () => { Env.set("ASKSAGE_API_KEY", "test-asksage-key") },
    fn: async () => {
      const providers = await Provider.list()
      expect(providers["asksage"].models["custom-model"]).toBeDefined()
      expect(providers["asksage"].models["custom-model"].name).toBe("My Custom AskSage Model")
      expect(providers["asksage"].models["claude-sonnet-4-6"]).toBeDefined()
    },
  })
})
