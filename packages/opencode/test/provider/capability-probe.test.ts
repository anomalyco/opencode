import { afterEach, describe, expect, test } from "bun:test"
import { CapabilityProbe } from "@/provider/capability-probe"

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  CapabilityProbe._resetCache()
})

function mockFetch(impl: (url: string) => Response | Promise<Response>) {
  globalThis.fetch = ((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
    return Promise.resolve(impl(url))
  }) as typeof fetch
}

describe("CapabilityProbe.probe", () => {
  test("detects prefill=false and reasoning=true when chat_template contains enable_thinking", async () => {
    mockFetch((url) => {
      expect(url).toBe("http://localhost:8080/props")
      return new Response(
        JSON.stringify({
          chat_template:
            "{%- if enable_thinking is defined and enable_thinking is false %}<think></think>{%- else %}<think>{%- endif %}",
        }),
        { status: 200 },
      )
    })
    const result = await CapabilityProbe.probe("http://localhost:8080/v1")
    expect(result).toEqual({ prefill: false, reasoning: true })
  })

  test("strips trailing /v1 from baseURL to find /props", async () => {
    let called = ""
    mockFetch((url) => {
      called = url
      return new Response("{}", { status: 200 })
    })
    await CapabilityProbe.probe("http://localhost:8080/v1/")
    expect(called).toBe("http://localhost:8080/props")
  })

  test("handles baseURL without /v1 suffix", async () => {
    let called = ""
    mockFetch((url) => {
      called = url
      return new Response("{}", { status: 200 })
    })
    await CapabilityProbe.probe("http://localhost:8080")
    expect(called).toBe("http://localhost:8080/props")
  })

  test("returns empty when /props is not present (404)", async () => {
    mockFetch(() => new Response("Not Found", { status: 404 }))
    const result = await CapabilityProbe.probe("http://localhost:8080/v1")
    expect(result).toEqual({})
  })

  test("returns empty when chat_template lacks enable_thinking", async () => {
    mockFetch(
      () =>
        new Response(JSON.stringify({ chat_template: "<|user|>{{ messages }}<|assistant|>" }), {
          status: 200,
        }),
    )
    const result = await CapabilityProbe.probe("http://localhost:8080/v1")
    expect(result).toEqual({})
  })

  test("detects reasoning=true from supports_preserve_reasoning even when chat_template is missing", async () => {
    mockFetch(
      () =>
        new Response(JSON.stringify({ chat_template_caps: { supports_preserve_reasoning: true } }), {
          status: 200,
        }),
    )
    const result = await CapabilityProbe.probe("http://localhost:8080/v1")
    expect(result.reasoning).toBe(true)
    // No prefill signal from supports_preserve_reasoning alone — only chat_template can determine that
    expect(result.prefill).toBeUndefined()
  })

  test("fails silent on network error", async () => {
    mockFetch(() => {
      throw new Error("ECONNREFUSED")
    })
    const result = await CapabilityProbe.probe("http://localhost:8080/v1")
    expect(result).toEqual({})
  })

  test("fails silent on invalid JSON", async () => {
    mockFetch(() => new Response("not-json", { status: 200 }))
    const result = await CapabilityProbe.probe("http://localhost:8080/v1")
    expect(result).toEqual({})
  })

  test("returns empty for empty baseURL", async () => {
    let called = false
    mockFetch(() => {
      called = true
      return new Response("{}", { status: 200 })
    })
    const result = await CapabilityProbe.probe("")
    expect(result).toEqual({})
    expect(called).toBe(false)
  })

  test("caches result per base URL — second call does not hit network", async () => {
    let calls = 0
    mockFetch(() => {
      calls++
      return new Response(JSON.stringify({ chat_template: "enable_thinking" }), { status: 200 })
    })
    const a = await CapabilityProbe.probe("http://localhost:8080/v1")
    const b = await CapabilityProbe.probe("http://localhost:8080/v1")
    expect(calls).toBe(1)
    expect(a).toEqual(b)
  })

  test("normalises trailing slashes for cache hits", async () => {
    let calls = 0
    mockFetch(() => {
      calls++
      return new Response("{}", { status: 200 })
    })
    await CapabilityProbe.probe("http://localhost:8080/v1")
    await CapabilityProbe.probe("http://localhost:8080/v1/")
    await CapabilityProbe.probe("http://localhost:8080")
    expect(calls).toBe(1)
  })
})
