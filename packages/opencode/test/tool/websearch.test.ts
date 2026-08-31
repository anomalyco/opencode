import { describe, expect, test } from "bun:test"
import { webSearchEnabled } from "../../src/tool/registry"
import { ProviderV2 } from "@opencode-ai/core/provider"

describe("websearch tool", () => {
  test("is always enabled (DuckDuckGo requires no API key)", () => {
    expect(webSearchEnabled(ProviderV2.ID.opencode)).toBe(true)
    expect(webSearchEnabled(ProviderV2.ID.openai)).toBe(true)
    expect(webSearchEnabled(ProviderV2.ID.anthropic)).toBe(true)
    expect(webSearchEnabled(ProviderV2.ID.openai, { exa: false, parallel: false })).toBe(true)
    expect(webSearchEnabled(ProviderV2.ID.openai, { exa: true, parallel: false })).toBe(true)
    expect(webSearchEnabled(ProviderV2.ID.openai, { exa: false, parallel: true })).toBe(true)
  })
})

describe("DuckDuckGo search script", () => {
  test("script file exists", async () => {
    const fs = require("fs")
    const path = require("path")
    const scriptPath = path.resolve(__dirname, "../../../../standalone-crawler/duckduckgo_search.py")
    expect(fs.existsSync(scriptPath)).toBe(true)
  })
})
