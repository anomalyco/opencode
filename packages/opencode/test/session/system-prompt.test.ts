import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "fs"
import path from "path"
import { SystemPrompt } from "../../src/session/system"
import { PROMPTS, SystemPromptSchema } from "../../src/session/prompt/registry"
import type { Provider } from "../../src/provider/provider"

const PROMPT_DIR = path.resolve(import.meta.dirname, "../../src/session/prompt")

function makeModel(
  overrides: { apiId?: string; systemPrompt?: Provider.Model["systemPrompt"] } = {},
): Provider.Model {
  return {
    id: "test-model",
    providerID: "test-provider",
    api: { id: overrides.apiId ?? "test-model", url: "", npm: "" },
    name: "Test Model",
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: false,
      toolcall: true,
      input: { text: true, audio: false, image: false, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit: { context: 128000, output: 4096 },
    status: "active",
    options: {},
    headers: {},
    release_date: "2025-01-01",
    systemPrompt: overrides.systemPrompt,
  }
}

describe("SystemPrompt.provider", () => {
  describe("model with explicit systemPrompt", () => {
    test("returns the matching prompt from the registry", () => {
      const model = makeModel({ systemPrompt: "gemini" })
      const [prompt] = SystemPrompt.provider(model)
      expect(prompt).toBe(PROMPTS["gemini"])
    })

    test.each(Object.keys(PROMPTS) as (keyof typeof PROMPTS)[])(
      "systemPrompt '%s' returns the correct registry entry",
      (name) => {
        const model = makeModel({ systemPrompt: name })
        const [prompt] = SystemPrompt.provider(model)
        expect(prompt).toBe(PROMPTS[name])
      },
    )
  })

  describe("fallback by model API id", () => {
    test("claude model returns anthropic prompt", () => {
      const model = makeModel({ apiId: "claude-3.5-sonnet" })
      const [prompt] = SystemPrompt.provider(model)
      expect(prompt).toBe(PROMPTS["anthropic"])
    })

    test("gemini model returns gemini prompt", () => {
      const model = makeModel({ apiId: "gemini-2.0-flash" })
      const [prompt] = SystemPrompt.provider(model)
      expect(prompt).toBe(PROMPTS["gemini"])
    })

    test("gpt-5 model returns codex prompt", () => {
      const model = makeModel({ apiId: "gpt-5.2" })
      const [prompt] = SystemPrompt.provider(model)
      expect(prompt).toBe(PROMPTS["codex"])
    })

    test("gpt-4o model returns beast prompt", () => {
      const model = makeModel({ apiId: "gpt-4o" })
      const [prompt] = SystemPrompt.provider(model)
      expect(prompt).toBe(PROMPTS["beast"])
    })

    test("o3-mini model returns beast prompt", () => {
      const model = makeModel({ apiId: "o3-mini" })
      const [prompt] = SystemPrompt.provider(model)
      expect(prompt).toBe(PROMPTS["beast"])
    })

    test("trinity model returns trinity prompt", () => {
      const model = makeModel({ apiId: "trinity-1.0" })
      const [prompt] = SystemPrompt.provider(model)
      expect(prompt).toBe(PROMPTS["trinity"])
    })
  })

  describe("fallback to default prompt", () => {
    test("unknown model returns qwen (default) prompt", () => {
      const model = makeModel({ apiId: "unknown-model-xyz" })
      const [prompt] = SystemPrompt.provider(model)
      expect(prompt).toBe(PROMPTS["qwen"])
    })
  })

  describe("explicit systemPrompt overrides model ID matching", () => {
    test("claude model with systemPrompt='gemini' returns gemini prompt", () => {
      const model = makeModel({ apiId: "claude-3.5-sonnet", systemPrompt: "gemini" })
      const [prompt] = SystemPrompt.provider(model)
      expect(prompt).toBe(PROMPTS["gemini"])
    })
  })
})

describe("registry completeness", () => {
  // A file is a registered system prompt if its content matches a value in PROMPTS.
  // Everything else must be in this exclusion list (utility or legacy files).
  // If upstream adds a new .txt file, this test fails — you must then either
  // add it to PROMPTS in registry.ts or add it here with a reason.
  const NON_SYSTEM_PROMPTS = new Set([
    // utility prompts used by prompt.ts
    "plan.txt",
    "build-switch.txt",
    "max-steps.txt",
    // legacy / unused files
    "anthropic-20250930.txt",
    "copilot-gpt-5.txt",
    "plan-reminder-anthropic.txt",
  ])

  const registryContents = new Set(Object.values(PROMPTS))

  function isInRegistry(filename: string) {
    const content = readFileSync(path.join(PROMPT_DIR, filename), "utf-8")
    return registryContents.has(content)
  }

  test("every .txt file is either in PROMPTS or in the known exclusion list", () => {
    const txtFiles = readdirSync(PROMPT_DIR).filter((f) => f.endsWith(".txt"))
    const unknown = txtFiles.filter((f) => !isInRegistry(f) && !NON_SYSTEM_PROMPTS.has(f))
    expect(unknown).toEqual([])
  })

  test("no exclusion list entry has been added to the registry (keep lists in sync)", () => {
    const stale = [...NON_SYSTEM_PROMPTS].filter((f) => isInRegistry(f))
    expect(stale).toEqual([])
  })
})

describe("SystemPromptSchema", () => {
  test("accepts valid prompt names", () => {
    for (const name of Object.keys(PROMPTS)) {
      const result: string | undefined = SystemPromptSchema.parse(name)
      expect(result).toBe(name)
    }
  })

  test("accepts undefined (optional)", () => {
    expect(SystemPromptSchema.parse(undefined)).toBeUndefined()
  })

  test("rejects invalid prompt names", () => {
    expect(() => SystemPromptSchema.parse("invalid-prompt-name")).toThrow()
  })
})
