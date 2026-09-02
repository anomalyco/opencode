import { expect, test } from "bun:test"
import { applyOpenAICompatibleDefaults } from "@/provider/provider"

// Regression tests for the default stream-idle guard on @ai-sdk/openai-compatible
// providers (issue #46581). Without a default chunkTimeout, a backend that stalls
// mid-stream hangs the session indefinitely; named providers already default a
// timeout, custom openai-compatible ones did not.

test("defaults chunkTimeout for openai-compatible when unset", () => {
  const options = applyOpenAICompatibleDefaults("@ai-sdk/openai-compatible", {})
  expect(typeof options.chunkTimeout).toBe("number")
  expect(options.chunkTimeout).toBeGreaterThan(0)
  expect(options.includeUsage).toBe(true)
})

test("does not override an explicitly configured chunkTimeout", () => {
  const options = applyOpenAICompatibleDefaults("@ai-sdk/openai-compatible", { chunkTimeout: 5_000 })
  expect(options.chunkTimeout).toBe(5_000)
})

test("does not override an explicit includeUsage=false", () => {
  const options = applyOpenAICompatibleDefaults("@ai-sdk/openai-compatible", { includeUsage: false })
  expect(options.includeUsage).toBe(false)
})

test("leaves non-openai-compatible providers untouched", () => {
  const options = applyOpenAICompatibleDefaults("@ai-sdk/anthropic", {})
  expect(options.chunkTimeout).toBeUndefined()
  expect(options.includeUsage).toBeUndefined()
})
