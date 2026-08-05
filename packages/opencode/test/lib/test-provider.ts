// Shared provider config for tests that need opencode to talk to a fake LLM
// over a real HTTP endpoint. Registers a single provider `test` with two models,
// `test-model` (the default `--model test/test-model`) and `test-model-alt`, for
// tests that need output attributed to a specific model. Both point at the URL
// the caller supplies (typically a TestLLMServer instance).
//
// Used by:
//   - test/lib/run-process.ts          (subprocess CLI tests)
//   - test/server/httpapi-sdk.test.ts  (in-process SDK tests)
export function testProviderConfig(llmUrl: string) {
  return {
    formatter: false,
    lsp: false,
    provider: {
      test: {
        name: "Test",
        id: "test",
        env: [],
        npm: "@ai-sdk/openai-compatible",
        models: {
          "test-model": {
            id: "test-model",
            name: "Test Model",
            attachment: false,
            reasoning: false,
            temperature: false,
            tool_call: true,
            release_date: "2025-01-01",
            limit: { context: 100_000, output: 10_000 },
            cost: { input: 0, output: 0 },
            options: {},
          },
          // Second model so tests can assert output is attributed to the model
          // that produced it, not to a hardcoded default.
          "test-model-alt": {
            id: "test-model-alt",
            name: "Test Model Alt",
            attachment: false,
            reasoning: false,
            temperature: false,
            tool_call: true,
            release_date: "2025-01-01",
            limit: { context: 100_000, output: 10_000 },
            cost: { input: 0, output: 0 },
            options: {},
          },
        },
        options: { apiKey: "test-key", baseURL: llmUrl },
      },
    },
  }
}
