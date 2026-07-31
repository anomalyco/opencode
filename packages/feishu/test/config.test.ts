import { describe, expect, test } from "bun:test"
import { assertDeepSeekModel, parseGatewayConfig, preflightDeepSeek } from "../src/config"

const valid = {
  FEISHU_APP_ID: "cli_test",
  FEISHU_APP_SECRET: "secret-canary",
  FEISHU_MODEL: "deepseek/deepseek-chat",
  FEISHU_DATA_DIRECTORY: "D:\\data\\feishu",
  FEISHU_WORKSPACE_DIRECTORY: "D:\\opencode",
}

describe("gateway configuration", () => {
  test("normalizes required values and bounded defaults", () => {
    expect(parseGatewayConfig(valid)).toEqual({
      appID: "cli_test",
      appSecret: "secret-canary",
      model: { providerID: "deepseek", modelID: "deepseek-chat" },
      dataDirectory: "D:\\data\\feishu",
      workspaceDirectory: "D:\\opencode",
      maxConcurrency: 4,
      replyAttempts: 3,
      replyTimeoutMs: 15_000,
    })
  })

  test("reports missing field names without configured secret values", () => {
    expect(() =>
      parseGatewayConfig({
        FEISHU_APP_SECRET: "secret-canary",
        FEISHU_DATA_DIRECTORY: "D:\\data\\feishu",
      }),
    ).toThrow("FEISHU_APP_ID, FEISHU_MODEL, FEISHU_WORKSPACE_DIRECTORY")

    try {
      parseGatewayConfig({
        FEISHU_APP_SECRET: "secret-canary",
        FEISHU_DATA_DIRECTORY: "D:\\data\\feishu",
      })
    } catch (error) {
      expect(String(error)).not.toContain("secret-canary")
    }
  })

  test("rejects malformed and non-positive numeric settings", () => {
    expect(() => parseGatewayConfig({ ...valid, FEISHU_MODEL: "deepseek" })).toThrow("FEISHU_MODEL")
    expect(() => parseGatewayConfig({ ...valid, FEISHU_MAX_CONCURRENCY: "0" })).toThrow("FEISHU_MAX_CONCURRENCY")
    expect(() => parseGatewayConfig({ ...valid, FEISHU_REPLY_ATTEMPTS: "2.5" })).toThrow("FEISHU_REPLY_ATTEMPTS")
    expect(() => parseGatewayConfig({ ...valid, FEISHU_REPLY_TIMEOUT_MS: "abc" })).toThrow("FEISHU_REPLY_TIMEOUT_MS")
  })

  test("allows only a DeepSeek provider and model", () => {
    expect(() => assertDeepSeekModel({ providerID: "openai", modelID: "deepseek-chat" })).toThrow("DeepSeek")
    expect(() => assertDeepSeekModel({ providerID: "deepseek", modelID: "gpt-4" })).toThrow("DeepSeek")
    expect(() => assertDeepSeekModel({ providerID: "deepseek", modelID: "deepseek-chat" })).not.toThrow()
  })

  test("preflight rejects unavailable authentication without leaking resolver details", async () => {
    await expect(
      preflightDeepSeek({ providerID: "deepseek", modelID: "deepseek-chat" }, async () => ({
        providerID: "deepseek",
        modelID: "deepseek-chat",
        authenticated: false,
      })),
    ).rejects.toThrow("DeepSeek model authentication is unavailable")
  })

  test("preflight rejects resolver model substitution", async () => {
    await expect(
      preflightDeepSeek({ providerID: "deepseek", modelID: "deepseek-chat" }, async () => ({
        providerID: "deepseek",
        modelID: "deepseek-reasoner",
        authenticated: true,
      })),
    ).rejects.toThrow("DeepSeek model resolution mismatch")
  })
})
