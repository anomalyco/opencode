import { describe, expect, test } from "bun:test"
import { isContextOverflow } from "../src/index.js"
import { classifyProviderFailure } from "../src/provider-error.js"

describe("provider error classification", () => {
  test("classifies provider token limit messages as context overflow", () => {
    const messages = [
      "tokens in request more than max tokens allowed",
      "Requested token count exceeds the model's maximum context length of 131072 tokens.",
      "Input length (265330) exceeds model's maximum context length (262144).",
      "Input length 131393 exceeds the maximum allowed input length of 131040 tokens.",
      "The input (516368 tokens) is longer than the model's context length (262144 tokens).",
      "Prompt has 5,958,968 tokens, but the configured context size is 256,000 tokens",
      "Range of input length should be [1, 129024]",
      "Too many tokens",
      "Token limit exceeded",
    ]

    expect(messages.every(isContextOverflow)).toBe(true)
  })

  test("classifies Anthropic request_too_large as recoverable overflow", () => {
    expect(
      classifyProviderFailure({
        message: '{"error":{"type":"request_too_large","message":"Request exceeds the maximum size"}}',
        status: 400,
      }),
    ).toMatchObject({ _tag: "InvalidRequest", classification: "context-overflow" })
    expect(isContextOverflow("413 status code (no body)")).toBe(true)
  })

  test("classifies generic request size failures separately from context overflow", () => {
    const failures = [
      classifyProviderFailure({ message: "request too large", status: 413 }),
      classifyProviderFailure({ message: "upstream request entity too large", status: 502 }),
    ]

    expect(failures).toEqual(
      failures.map((failure) =>
        expect.objectContaining({ _tag: "InvalidRequest", classification: "payload-too-large" }),
      ),
    )
  })

  test("does not classify rate limits as context overflow", () => {
    const messages = [
      "Throttling error: Too many tokens, please wait before trying again.",
      "Rate limit exceeded, please retry after 30 seconds.",
      "Too many requests. Please slow down.",
    ]

    expect(messages.some(isContextOverflow)).toBe(false)
  })

  test("classifies V1 plain-text rate limit fallbacks", () => {
    expect(
      [
        "Request rate increased too quickly",
        "Rate limit exceeded, please try again later",
        "Too many requests, please slow down",
      ].map((message) => classifyProviderFailure({ message })._tag),
    ).toEqual(["RateLimit", "RateLimit", "RateLimit"])
  })

  test("classifies V1 JSON rate limit fallbacks", () => {
    expect(
      [
        '{"type":"error","error":{"type":"too_many_requests"}}',
        '{"type":"error","error":{"code":"rate_limit_exceeded"}}',
        '{"code":"bad_request","error":{"code":"rate_limit_exceeded"}}',
        '{"type":"error","error":{"code":"unknown","type":"too_many_requests"}}',
      ].map((message) => classifyProviderFailure({ message })._tag),
    ).toEqual(["RateLimit", "RateLimit", "RateLimit", "RateLimit"])
  })

  test("classifies V1 overloaded provider codes", () => {
    expect(
      ['{"code":"resource_exhausted"}', '{"code":"service_unavailable"}', '{"code":"slow_down"}'].map(
        (message) => classifyProviderFailure({ message })._tag,
      ),
    ).toEqual(["ProviderInternal", "ProviderInternal", "ProviderInternal"])
  })

  test("classifies retryable server messages as provider internal", () => {
    const message =
      "The model is currently at capacity due to high demand. Please try again in a few minutes, or use a higher service tier for priority processing."

    expect(
      [
        message,
        "Try again",
        "Please retry your request shortly.",
        "You can retry the request.",
        "Try your request again.",
        "The service is temporarily at capacity.",
        "The model is overloaded.",
        "Service unavailable",
        "Internal server error",
        "The server is busy.",
        "Provider returned error",
        "Provider returned an error",
        "ResourceExhausted",
        "Upstream connection failed",
        "Exceeded request buffer limit while retrying upstream",
      ].map((message) => classifyProviderFailure({ message })._tag),
    ).toEqual(Array(15).fill("ProviderInternal"))
    expect(
      classifyProviderFailure({ message: "Provider request failed", rawBody: "Please try again later." })._tag,
    ).toBe("ProviderInternal")
  })

  test("prioritizes specific failures over retryable server text", () => {
    expect(
      [
        classifyProviderFailure({ message: "Invalid credentials, try again", status: 401 }),
        classifyProviderFailure({ message: "Quota exceeded, try again", status: 429 }),
        classifyProviderFailure({ message: "Rate limit exceeded, try again" }),
        classifyProviderFailure({ message: "Upstream request failed: validation failed", status: 400 }),
        classifyProviderFailure({ message: "Try again", status: 200 }),
      ].map((failure) => failure._tag),
    ).toEqual(["Authentication", "QuotaExceeded", "RateLimit", "InvalidRequest", "ProviderInternal"])
  })

  test("classifies Azure content filter rejections by their structured codes", () => {
    const message = "The response was filtered"
    const azure = {
      error: {
        message,
        type: null,
        param: "prompt",
        code: "content_filter",
        status: 400,
        innererror: { code: "ResponsibleAIPolicyViolation", content_filter_result: {} },
      },
    }
    const innerOnly = { error: { message, code: null, innererror: { code: "ResponsibleAIPolicyViolation" } } }

    expect(classifyProviderFailure({ message, status: 400, rawBody: JSON.stringify(azure) })._tag).toBe("ContentPolicy")
    expect(classifyProviderFailure({ message, status: 400, rawBody: JSON.stringify(innerOnly) })._tag).toBe(
      "ContentPolicy",
    )
  })

  test("classifies policy rejections that reuse generic request codes by the provider explanation", () => {
    const openai = {
      error: {
        message:
          "Invalid prompt: your prompt was flagged as potentially violating our usage policy. Please try again with a different prompt.",
        type: "invalid_request_error",
        param: null,
        code: "invalid_prompt",
      },
    }
    const anthropic = {
      type: "error",
      error: { type: "invalid_request_error", message: "Output blocked by content filtering policy" },
    }

    expect(
      [openai, anthropic].map(
        (body) =>
          classifyProviderFailure({ message: body.error.message, status: 400, rawBody: JSON.stringify(body) })._tag,
      ),
    ).toEqual(["ContentPolicy", "ContentPolicy"])
  })

  test("classifies OpenRouter typed policy errors across its API skins", () => {
    const chat = {
      id: "gen-abc123",
      object: "chat.completion.chunk",
      error: {
        code: 403,
        message: "Your input was flagged",
        metadata: { error_type: "content_policy_violation", reasons: ["violence"], flagged_input: "..." },
      },
      choices: [{ index: 0, delta: { content: "" }, finish_reason: "error" }],
    }
    const responses = {
      type: "response.failed",
      response: {
        id: "resp_abc123",
        status: "failed",
        error: { code: "image_content_policy_violation", message: "Your input was flagged" },
        error_type: "content_policy_violation",
      },
    }
    const messages = {
      type: "error",
      error: { type: "invalid_request_error", message: "Claude refused to respond", error_type: "refusal" },
    }

    expect(
      [
        classifyProviderFailure({ message: chat.error.message, status: 403, rawBody: JSON.stringify(chat) }),
        classifyProviderFailure({ message: responses.response.error.message, rawBody: JSON.stringify(responses) }),
        classifyProviderFailure({ message: messages.error.message, rawBody: JSON.stringify(messages) }),
      ].map((failure) => failure._tag),
    ).toEqual(["ContentPolicy", "ContentPolicy", "ContentPolicy"])
  })

  test("recovers policy codes that OpenCode Zen preserves only in its message label", () => {
    // Zen drops upstream codes outside its allow-list and replaces the type, but
    // `Protocol.errorMessage` keeps the original code as a `[code]` prefix.
    const zen = {
      error: {
        type: "server_error",
        message: "Upstream request failed: [content_filter] The response was filtered",
      },
    }

    expect(
      classifyProviderFailure({ message: zen.error.message, status: 400, rawBody: JSON.stringify(zen) })._tag,
    ).toBe("ContentPolicy")
  })

  test("keeps invalid_prompt schema validation failures as invalid requests", () => {
    // Bedrock Mantle reports request validation failures under `invalid_prompt`
    // with a pydantic dump that lists every input union member's fields.
    const message = [
      "SubmitRequestFailure: code=-32602, msg=219 validation errors for ResponsesRequest",
      "input.list[union[EasyInputMessageParam,ResponseComputerToolCallParam]].2.ResponseComputerToolCallParam.pending_safety_checks",
      "  Field required [type=missing, input_value={'content': [...], 'role': 'assistant', 'type': 'message'}, input_type=dict]",
    ].join("\n")
    const failure = classifyProviderFailure({
      message,
      status: 200,
      rawBody: JSON.stringify({ response: { status: "failed", error: { code: "invalid_prompt", message } } }),
    })

    expect(failure._tag).toBe("InvalidRequest")
  })

  test("does not infer content policy from policy phrases outside the provider explanation", () => {
    const failure = classifyProviderFailure({
      message: "Provider request failed with HTTP 400",
      status: 400,
      rawBody: JSON.stringify({ error: { message: "Unknown parameter: content_policy_id" } }),
    })

    expect(failure._tag).toBe("InvalidRequest")
  })

  test("classifies transient client statuses as provider internal", () => {
    expect([408, 409].map((status) => classifyProviderFailure({ message: `HTTP ${status}`, status })._tag)).toEqual([
      "ProviderInternal",
      "ProviderInternal",
    ])
  })

  test("classifies any remaining 4xx status as an invalid request", () => {
    expect(
      [400, 402, 404, 418, 422, 451].map(
        (status) => classifyProviderFailure({ message: `HTTP ${status}`, status })._tag,
      ),
    ).toEqual(Array(6).fill("InvalidRequest"))
  })

  test("classifies nested provider codes when a top-level code is also present", () => {
    expect(
      [
        '{"code":"bad_request","error":{"code":"usage_not_included"}}',
        '{"code":"bad_request","error":{"code":"server_error"}}',
        '{"code":"bad_request","error":{"type":"invalid_request_error"}}',
      ].map((message) => classifyProviderFailure({ message })._tag),
    ).toEqual(["QuotaExceeded", "ProviderInternal", "InvalidRequest"])
  })

  test("leaves unrecognized failures unclassified for the retry default", () => {
    expect(classifyProviderFailure({ message: '{"error":{"message":"no_kv_space"}}' })._tag).toBe("UnknownProvider")
    expect(classifyProviderFailure({ message: '{"type":"error","error":{"code":123}}' })._tag).toBe("UnknownProvider")
    expect(classifyProviderFailure({ message: "not-json" })._tag).toBe("UnknownProvider")
    expect(classifyProviderFailure({ message: "network error" })._tag).toBe("UnknownProvider")
  })
})

describe("provider error rawBody classification", () => {
  test("classifies provider envelopes without separate code inputs", () => {
    const cases = [
      ['{"type":"error","error":{"type":"overloaded_error","message":"Try again"}}', "ProviderInternal"],
      ['{"error":{"code":"insufficient_quota","message":"Request failed"}}', "QuotaExceeded"],
      [
        '{"type":"response.failed","response":{"error":{"code":"authentication_error","message":"Denied"}}}',
        "Authentication",
      ],
      ['{"error":{"code":429,"status":"RESOURCE_EXHAUSTED","message":"Try again"}}', "ProviderInternal"],
      ['{"exception":{"type":"throttlingException","details":{"message":"Try again"}}}', "RateLimit"],
    ] as const
    for (const [rawBody, expected] of cases) {
      const reason = classifyProviderFailure({ message: "Request failed", rawBody })
      expect(reason._tag).toBe(expected)
      expect(reason.body).toBe(rawBody)
      expect(reason).not.toHaveProperty("code")
    }
  })

  test("classifies separately supplied SDK data without replacing the response body", () => {
    const data = { error: { code: "authentication_error" } }
    for (const value of [data, JSON.stringify(data)]) {
      const reason = classifyProviderFailure({
        message: "Request failed",
        status: 400,
        rawBody: '{"message":"Request failed"}',
        data: value,
      })
      expect(reason._tag).toBe("Authentication")
      expect(reason.body).toBe('{"message":"Request failed"}')
    }
  })

  test("classifies overflow signals buried in the raw payload when the summary is vague", () => {
    const reason = classifyProviderFailure({
      message: "Request failed",
      rawBody: '{"error":{"message":"This model\'s maximum context length is 40960 tokens"}}',
    })
    expect(reason._tag).toBe("InvalidRequest")
    expect(reason).toMatchObject({ classification: "context-overflow" })
  })

  test("extracts nested codes from the raw payload", () => {
    expect(
      classifyProviderFailure({ message: "Request failed", rawBody: '{"error":{"code":"insufficient_quota"}}' })._tag,
    ).toBe("QuotaExceeded")
  })
})
