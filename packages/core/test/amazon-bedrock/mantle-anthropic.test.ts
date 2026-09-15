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

const stream = () =>
  new Response(
    [
      'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_test","type":"message","role":"assistant","model":"claude-opus-4-8","content":[],"stop_reason":null,"usage":{"input_tokens":1,"output_tokens":0}}}\n\n',
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"ok"}}\n\n',
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ].join(""),
    { status: 200, headers: { "content-type": "text/event-stream" } },
  )

const prompt = [{ role: "user" as const, content: [{ type: "text" as const, text: "hi" }] }]

describe("createBedrockMantleAnthropic", () => {
  test("signs with SigV4 and drops a caller-supplied Anthropic key header", async () => {
    const captured: { url?: string; headers?: Headers } = {}
    // An ambient AWS_BEARER_TOKEN_BEDROCK would switch this to the key path.
    await withEnv({ AWS_BEARER_TOKEN_BEDROCK: undefined }, async () => {
      const provider = createBedrockMantleAnthropic({
        region: "us-east-1",
        headers: { "x-api-key": "caller-supplied-key" },
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
    })

    expect(captured.url).toBe("https://bedrock-mantle.us-east-1.api.aws/anthropic/v1/messages")
    expect(captured.headers?.get("authorization")).toStartWith("AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/")
    expect(captured.headers?.get("authorization")).toInclude("/us-east-1/bedrock-mantle/aws4_request")
    expect(captured.headers?.get("x-amz-security-token")).toBe("session-token")
    expect(captured.headers?.has("x-api-key")).toBe(false)
  })

  test("signs streaming requests", async () => {
    const captured: { headers?: Headers; body?: Record<string, any> } = {}
    await withEnv({ AWS_BEARER_TOKEN_BEDROCK: undefined }, async () => {
      const provider = createBedrockMantleAnthropic({
        region: "us-east-1",
        credentialProvider: async () => ({
          accessKeyId: "AKIAIOSFODNN7EXAMPLE",
          secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
        }),
        fetch: (async (_input: string | URL | Request, init?: RequestInit) => {
          captured.headers = new Headers(init?.headers)
          captured.body = JSON.parse(init?.body as string)
          return stream()
        }) as unknown as typeof fetch,
      })
      const result = await provider.languageModel("anthropic.claude-opus-4-8").doStream({ prompt, maxOutputTokens: 16 })
      const parts = await Array.fromAsync(result.stream)
      expect(parts.map((part) => part.type)).toContain("text-delta")
    })

    expect(captured.body?.["stream"]).toBe(true)
    expect(captured.headers?.get("authorization")).toStartWith("AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/")
  })

  test("uses x-api-key auth and skips signing when an API key is set", async () => {
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

  test("signs with static AWS env credentials when no credential provider is given", async () => {
    const captured: { headers?: Headers } = {}
    await withEnv(
      {
        AWS_BEARER_TOKEN_BEDROCK: undefined,
        AWS_ACCESS_KEY_ID: "AKIAIOSFODNN7EXAMPLE",
        AWS_SECRET_ACCESS_KEY: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
        AWS_SESSION_TOKEN: "env-token",
      },
      async () => {
        const provider = createBedrockMantleAnthropic({
          region: "us-east-1",
          fetch: (async (_input: string | URL | Request, init?: RequestInit) => {
            captured.headers = new Headers(init?.headers)
            return response()
          }) as unknown as typeof fetch,
        })
        await provider.languageModel("anthropic.claude-opus-4-8").doGenerate({ prompt, maxOutputTokens: 16 })
      },
    )

    expect(captured.headers?.get("authorization")).toStartWith("AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/")
    expect(captured.headers?.get("x-amz-security-token")).toBe("env-token")
  })

  test("routes a JSON response format through the json tool instead of output_config.format", async () => {
    const captured: { body?: Record<string, any> } = {}
    const provider = createBedrockMantleAnthropic({
      region: "us-east-1",
      apiKey: "bedrock-api-key",
      fetch: (async (_input: string | URL | Request, init?: RequestInit) => {
        captured.body = JSON.parse(init?.body as string)
        return response()
      }) as unknown as typeof fetch,
    })

    await provider.languageModel("anthropic.claude-opus-4-8").doGenerate({
      prompt,
      maxOutputTokens: 16,
      responseFormat: {
        type: "json",
        schema: { type: "object", properties: { answer: { type: "string" } }, required: ["answer"] },
      },
    })

    // Mantle answers 400 "output_config.format: Extra inputs are not permitted".
    expect(captured.body?.["output_config"]?.["format"]).toBeUndefined()
    expect(captured.body?.["tools"]).toEqual([
      {
        name: "json",
        description: "Respond with a JSON object.",
        input_schema: { type: "object", properties: { answer: { type: "string" } }, required: ["answer"] },
      },
    ])
    expect(captured.body?.["tool_choice"]).toEqual({ type: "any", disable_parallel_tool_use: true })
  })

  test("does not forward a tool-level strict field", async () => {
    const captured: { body?: Record<string, any> } = {}
    const provider = createBedrockMantleAnthropic({
      region: "us-east-1",
      apiKey: "bedrock-api-key",
      fetch: (async (_input: string | URL | Request, init?: RequestInit) => {
        captured.body = JSON.parse(init?.body as string)
        return response()
      }) as unknown as typeof fetch,
    })

    const result = await provider.languageModel("anthropic.claude-opus-4-8").doGenerate({
      prompt,
      maxOutputTokens: 16,
      tools: [
        {
          type: "function",
          name: "echo",
          description: "echo the input",
          inputSchema: { type: "object", properties: { text: { type: "string" } } },
          strict: true,
        },
      ],
    })

    // Mantle answers 400 "tools.0.custom.strict: Extra inputs are not permitted".
    expect(captured.body?.["tools"]?.[0]).not.toHaveProperty("strict")
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ type: "unsupported", feature: expect.stringContaining("strict") }),
    )
  })

  test("normalizes a trailing slash on a configured base URL", async () => {
    const captured: { url?: string } = {}
    const provider = createBedrockMantleAnthropic({
      region: "us-east-1",
      apiKey: "bedrock-api-key",
      baseURL: "https://bedrock-mantle.us-east-1.api.aws/anthropic/v1/",
      fetch: (async (input: string | URL | Request) => {
        captured.url = input.toString()
        return response()
      }) as unknown as typeof fetch,
    })

    await provider.languageModel("anthropic.claude-opus-4-8").doGenerate({ prompt, maxOutputTokens: 16 })

    expect(captured.url).toBe("https://bedrock-mantle.us-east-1.api.aws/anthropic/v1/messages")
  })

  test("throws when neither an API key nor AWS credentials are available", async () => {
    await withEnv(
      {
        AWS_BEARER_TOKEN_BEDROCK: undefined,
        AWS_ACCESS_KEY_ID: undefined,
        AWS_SECRET_ACCESS_KEY: undefined,
        AWS_SESSION_TOKEN: undefined,
      },
      async () => {
        const provider = createBedrockMantleAnthropic({ region: "us-east-1" })
        await expect(
          provider.languageModel("anthropic.claude-opus-4-8").doGenerate({ prompt, maxOutputTokens: 16 }),
        ).rejects.toThrow("Bedrock Mantle requires either an API key or AWS credentials for SigV4 signing")
      },
    )
  })
})

async function withEnv(vars: Record<string, string | undefined>, fn: () => Promise<void>) {
  const previous = Object.fromEntries(Object.keys(vars).map((key) => [key, process.env[key]]))
  const apply = (values: Record<string, string | undefined>) =>
    Object.entries(values).forEach(([key, value]) => {
      if (value === undefined) {
        delete process.env[key]
        return
      }
      process.env[key] = value
    })
  apply(vars)
  await fn().finally(() => apply(previous))
}
