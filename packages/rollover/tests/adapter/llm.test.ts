import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { createLlm, type GenerateHost } from "../../src/adapter/opencode/llm"

function host(text: string): GenerateHost {
  return { experimental: { generate: { text: () => Effect.succeed({ text }) } } }
}

function failingHost(message: string): GenerateHost {
  return { experimental: { generate: { text: () => Effect.fail(new Error(message)) } } }
}

describe("createLlm", () => {
  test("reports unavailable usage as null — never invented zeros", async () => {
    const llm = createLlm({ host: host("{}"), resolveModel: () => null })
    const res = await llm.complete({ purpose: "extraction", system: "s", user: "u", maxOutputTokens: 10, timeoutMs: 1000 })
    expect(res.usage).toBeNull()
    expect(res.text).toBe("{}")
  })

  test("emits one llm_call metric per call with purpose, model, latency", async () => {
    const calls: Array<{ purpose: string; ok: boolean; model?: string; latencyMs: number; usage: unknown }> = []
    const llm = createLlm({
      host: host("{}"),
      resolveModel: () => null,
      onCall: (info) => calls.push(info),
    })
    await llm.complete({ purpose: "extraction", system: "s", user: "u", maxOutputTokens: 10, timeoutMs: 1000, model: "p/m" })
    await llm.complete({ purpose: "consolidation", system: "s", user: "u", maxOutputTokens: 10, timeoutMs: 1000 })
    expect(calls.length).toBe(2)
    expect(calls[0].purpose).toBe("extraction")
    expect(calls[0].ok).toBe(true)
    expect(calls[0].model).toBe("p/m")
    expect(calls[0].usage).toBeNull()
    expect(typeof calls[0].latencyMs).toBe("number")
    expect(calls[1].purpose).toBe("consolidation")
  })

  test("failed generate calls are tagged llm-error and reported ok:false", async () => {
    const calls: Array<{ purpose: string; ok: boolean; error?: string }> = []
    const llm = createLlm({ host: failingHost("quota exceeded"), resolveModel: () => null, onCall: (info) => calls.push(info) })
    let message = ""
    try {
      await llm.complete({ purpose: "extraction", system: "s", user: "u", maxOutputTokens: 10, timeoutMs: 1000 })
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
    expect(message).toContain("llm-error")
    expect(message).toContain("quota exceeded")
    expect(calls.length).toBe(1)
    expect(calls[0].ok).toBe(false)
    expect(calls[0].error).toContain("quota exceeded")
  })
})
