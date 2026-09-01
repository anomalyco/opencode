The model normalization function doesn't handle uppercase model names. When a model name like `GPT-5-Free` is passed to `normalizeInferenceModel`, it should be lowercased before stripping suffixes, so the result is `gpt-5` not `GPT-5`.

Fix `packages/stats/core/src/domain/model-normalization.ts` by adding `.toLowerCase()` before the `.replace()` call in the `normalizeInferenceModel` function.

Write a test that verifies `GPT-5-Free` normalizes to `gpt-5`.


