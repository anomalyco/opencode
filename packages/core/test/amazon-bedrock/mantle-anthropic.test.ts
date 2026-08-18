import { describe, expect, test } from "bun:test"
import { createBedrockMantleAnthropic } from "@opencode-ai/core/amazon-bedrock/mantle-anthropic"

const response = () =>
  new Response(
    JSON.stringify({
      id: "msg_test",
      type: "message",
      role: "assistant",
      model: "claude-opus-4-8",
      content: [{ type: "text", text: "ok" }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  )

const prompt = [{ role: "user" as const, content: [{ type: "text" as const, text: "hi" }] }]

describe("createBedrockMantleAnthropic", () => {
  test("signs with SigV4 and drops the Anthropic key header", async () => {
    const captured: { url?: string; headers?: Headers } = {}
    const provider = createBedrockMantleAnthropic({
      region: "us-east-1",
      credentialProvider: async () => ({
        accessKeyId: "AKIAIOSFODNN7EXAMPLE",
        secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
        sessionToken: "session-token",
      }),
      fetch: (async (input: string | URL | Request, init?: RequestInit) => {
        captured.url = input.toString()
        captured.headers = new Headers(init?.headers)
        return response()
      }) as unknown as typeof fetch,
    })

    await provider.languageModel("anthropic.claude-opus-4-8").doGenerate({ prompt, maxOutputTokens: 16 })

    expect(captured.url).toBe("https://bedrock-mantle.us-east-1.api.aws/anthropic/v1/messages")
    expect(captured.headers?.get("authorization")).toStartWith("AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/")
    expect(captured.headers?.get("authorization")).toInclude("/us-east-1/bedrock-mantle/aws4_request")
    expect(captured.headers?.get("x-amz-security-token")).toBe("session-token")
    expect(captured.headers?.has("x-api-key")).toBe(false)
  })

  test("uses bearer auth and skips signing when an API key is set", async () => {
    const captured: { headers?: Headers } = {}
    const provider = createBedrockMantleAnthropic({
      region: "eu-west-1",
      apiKey: "bedrock-api-key",
      fetch: (async (_input: string | URL | Request, init?: RequestInit) => {
        captured.headers = new Headers(init?.headers)
        return response()
      }) as unknown as typeof fetch,
    })

    await provider.languageModel("anthropic.claude-opus-4-8").doGenerate({ prompt, maxOutputTokens: 16 })

    expect(captured.headers?.get("x-api-key")).toBe("bedrock-api-key")
    expect(captured.headers?.has("authorization")).toBe(false)
  })
})
