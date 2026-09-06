The `textVerbosity` parameter is being injected for all OpenAI-compatible providers, but generic OpenAI-compatible APIs don't necessarily support this parameter. It should only be enabled for providers that are known to implement it.

Fix `packages/opencode/src/provider/transform.ts` in the `options` function. Instead of excluding Azure specifically, check that the provider's npm package is either `@ai-sdk/openai` or `@ai-sdk/amazon-bedrock/mantle` before setting `textVerbosity`.

Write a test that verifies `textVerbosity` is `undefined` for non-Responses providers (e.g., `@ai-sdk/openai-compatible`).


