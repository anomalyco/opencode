import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  CONTEXT_NOTE,
  SecurecodeContextPromptPlugin,
  isDisabled,
} from "../../../src/securecode/plugins/securecode-context-prompt"

const stubPluginInput = {} as Parameters<typeof SecurecodeContextPromptPlugin>[0]
const DISABLE_ENV = "SECURECODE_CONTEXT_PROMPT_DISABLE"

beforeEach(() => {
  delete process.env[DISABLE_ENV]
})

afterEach(() => {
  delete process.env[DISABLE_ENV]
})

const stubHookInput = { sessionID: "s1", model: { id: "claude-sonnet-4-6" } as any }

describe("SecurecodeContextPromptPlugin", () => {
  test("folds CONTEXT_NOTE into system[0] without adding a second entry (Issue #288)", async () => {
    const hooks = await SecurecodeContextPromptPlugin(stubPluginInput)
    const transform = hooks["experimental.chat.system.transform"]!
    const output = { system: ["You are a helpful assistant."] }
    await transform(stubHookInput as any, output as any)
    expect(output.system).toHaveLength(1)
    expect(output.system[0]).toContain("You are a helpful assistant.")
    expect(output.system[0]).toContain(CONTEXT_NOTE)
  })

  test("is idempotent — does not stack the note when called twice", async () => {
    const hooks = await SecurecodeContextPromptPlugin(stubPluginInput)
    const transform = hooks["experimental.chat.system.transform"]!
    const output = { system: ["agent prompt"] }
    await transform(stubHookInput as any, output as any)
    await transform(stubHookInput as any, output as any)
    expect(output.system).toHaveLength(1)
    const occurrences = output.system[0].split(CONTEXT_NOTE).length - 1
    expect(occurrences).toBe(1)
  })

  test("works on an empty system[]", async () => {
    const hooks = await SecurecodeContextPromptPlugin(stubPluginInput)
    const transform = hooks["experimental.chat.system.transform"]!
    const output = { system: [] as string[] }
    await transform(stubHookInput as any, output as any)
    expect(output.system).toEqual([CONTEXT_NOTE])
  })

  test("no-op when output is missing or malformed", async () => {
    const hooks = await SecurecodeContextPromptPlugin(stubPluginInput)
    const transform = hooks["experimental.chat.system.transform"]!
    await transform(stubHookInput as any, undefined as any)
    await transform(stubHookInput as any, {} as any)
    await transform(stubHookInput as any, { system: "not-an-array" } as any)
  })
})

describe("SecurecodeContextPromptPlugin disable env var", () => {
  test("returns no hooks when SECURECODE_CONTEXT_PROMPT_DISABLE=1", async () => {
    process.env[DISABLE_ENV] = "1"
    expect(isDisabled()).toBe(true)
    const hooks = await SecurecodeContextPromptPlugin(stubPluginInput)
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

describe("CONTEXT_NOTE content", () => {
  test("identifies the runtime as Acompany セキュアコード", () => {
    // Brand surface: the LLM-facing name is the Japanese form, since this
    // string ships into the system prompt and is read by users via the model.
    expect(CONTEXT_NOTE).toContain("Acompany セキュアコード")
  })

  test("states the LLM provider is in a TEE and not third-party", () => {
    expect(CONTEXT_NOTE).toMatch(/TEE|Trusted Execution Environment/)
    // The note must explicitly rule out third-party providers — otherwise the
    // model may volunteer "your prompt was sent to OpenAI" as a guess.
    expect(CONTEXT_NOTE).toMatch(/NOT.*(OpenAI|Anthropic|Google|third-party)/i)
  })

  test("does not hardcode a specific model family / version", () => {
    // The model is user-configurable via securecode.json; the note must
    // describe the TEE / endpoint property without pinning a specific model
    // (e.g. Qwen3.x), otherwise the LLM would confidently misreport itself
    // when the user has swapped models.
    expect(CONTEXT_NOTE).not.toMatch(/Qwen/i)
    expect(CONTEXT_NOTE).toMatch(/securecode\.json/)
  })

  test("describes the 2-layer sandbox", () => {
    expect(CONTEXT_NOTE).toMatch(/Layer 1/)
    expect(CONTEXT_NOTE).toMatch(/Layer 2/)
    expect(CONTEXT_NOTE).toMatch(/Permission/)
    expect(CONTEXT_NOTE).toMatch(/OS sandbox/i)
  })

  test("points users to sandbox.json as the remediation surface", () => {
    // The remediation pointer is the most actionable piece of the note —
    // without it, the model falls back to retry/silent-swallow patterns.
    expect(CONTEXT_NOTE).toContain("sandbox.json")
    expect(CONTEXT_NOTE).toMatch(/allowlist/i)
  })

  test("tells the model to invoke the securecode-manual skill for depth", () => {
    expect(CONTEXT_NOTE).toContain("securecode-manual")
    expect(CONTEXT_NOTE).toMatch(/skill/i)
    // The auto-allow exemption from PR #355 — explicitly stated so the model
    // does not hesitate to call the skill.
    expect(CONTEXT_NOTE).toMatch(/no permission dialog/i)
  })
})
