import { describe, expect, test } from "bun:test"
import { APICallError } from "ai"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ProviderError } from "@/provider/error"
import { SessionStaleReasoning } from "@/session/stale-reasoning"
import type { SessionV1 } from "@opencode-ai/core/v1/session"

describe("provider stream errors", () => {
  test("retries provider stream errors without a code", () => {
    const messages = [
      "The model is currently at capacity due to high demand. Please try again in a few minutes, or use a higher service tier for priority processing: https://docs.x.ai/developers/advanced-api-usage/priority-processing",
      "The model is temporarily unavailable.",
    ]

    for (const message of messages)
      expect(
        ProviderError.parseStreamError({
          type: "error",
          error: { message },
        }),
      ).toEqual({
        type: "api_error",
        message,
        isRetryable: true,
        responseBody: JSON.stringify({ type: "error", error: { message } }),
      })
  })

  test("classifies invalid encrypted reasoning as stale_reasoning", () => {
    expect(
      ProviderError.parseStreamError({
        type: "error",
        error: {
          code: "invalid_encrypted_content",
          message: "The encrypted content could not be verified",
        },
      }),
    ).toEqual({
      type: "stale_reasoning",
      message: "The encrypted content could not be verified",
      responseBody: JSON.stringify({
        type: "error",
        error: {
          code: "invalid_encrypted_content",
          message: "The encrypted content could not be verified",
        },
      }),
    })

    const error = new APICallError({
      message:
        "Error from provider (Console): Upstream request failed: [invalid_request_error] reasoning `encrypted_content` was not issued to this caller",
      url: "https://opencode.ai/zen/v1/responses",
      requestBodyValues: {},
      statusCode: 400,
      responseHeaders: { "content-type": "application/json" },
      isRetryable: false,
    })
    expect(ProviderError.parseAPICallError({ providerID: ProviderV2.ID.make("opencode"), error }).type).toBe(
      "stale_reasoning",
    )
  })
})

describe("stale reasoning request sanitizer", () => {
  test("drops openai replay blobs from reasoning parts", () => {
    const part = {
      id: "prt_1",
      sessionID: "ses_1",
      messageID: "msg_1",
      type: "reasoning",
      text: "thinking",
      time: { start: 1 },
      metadata: {
        openai: {
          itemId: "rs_1",
          reasoningEncryptedContent: "blob",
        },
      },
    } as SessionV1.ReasoningPart
    const next = SessionStaleReasoning.stripPart(part)
    expect(next.metadata?.openai).toBeUndefined()
    expect(next.text).toBe("thinking")

    const messages = [
      {
        role: "assistant" as const,
        content: [
          {
            type: "reasoning" as const,
            text: "thinking",
            providerOptions: { openai: { itemId: "rs_1", reasoningEncryptedContent: "blob" } },
          },
        ],
      },
    ]
    SessionStaleReasoning.stripRequest(messages)
    expect(messages[0]?.content[0]).toEqual({ type: "reasoning", text: "thinking" })
  })
})
