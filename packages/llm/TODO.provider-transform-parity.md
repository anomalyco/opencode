# Provider Transform Parity TODO

This tracks OpenCode behavior from `packages/opencode/src/provider/transform.ts` that is not fully represented in `packages/llm` yet.

Patches are the right seam when the behavior is a provider/model quirk that mutates request history, tool schemas, target bodies, or stream events. Do not add fields to the common request model just to carry one provider's native option.

## Ported Or Covered

- Empty Anthropic/Bedrock content cleanup: `ProviderPatch.removeEmptyAnthropicContent`.
- Claude tool id scrub: `ProviderPatch.scrubClaudeToolIds`.
- Mistral/Devstral tool id scrub: `ProviderPatch.scrubMistralToolIds`.
- Anthropic assistant `tool_use` ordering repair: `ProviderPatch.repairAnthropicToolUseOrder`.
- Mistral `tool -> user` sequence repair: `ProviderPatch.repairMistralToolResultUserSequence`.
- DeepSeek empty reasoning replay: `ProviderPatch.addDeepSeekEmptyReasoning` plus OpenAI-compatible native `reasoning_content` lowering.
- OpenAI-compatible reasoning history replay: `ProviderPatch.moveOpenAICompatibleReasoningToNative`.
- Unsupported user media fallback: `ProviderPatch.unsupportedMediaFallback`.
- Moonshot/Kimi schema sanitizer: `ProviderPatch.sanitizeMoonshotToolSchema`.
- Prompt cache hint placement: `ProviderPatch.cachePromptHints`.
- Gemini schema sanitizer/projector: handled inside `Gemini.protocol` because Gemini has a distinct schema dialect.
- OpenAI Chat/OpenAI-compatible streaming usage: adapter-local target patches.

## Not Fully Ported

### Provider Option Namespacing

OpenCode behavior:

- `ProviderTransform.providerOptions(...)` maps option bags into SDK namespaces like `openai`, `azure`, `gateway`, `openrouter`, `bedrock`, or model-derived Gateway upstream slugs.
- Azure currently writes both `{ openai: options, azure: options }` because different AI SDK code paths read different namespaces.
- Gateway splits `gateway` routing/caching controls from upstream model options.

Native status:

- Not ported as a general system.
- The native OpenCode bridge currently falls back when prepared provider options are non-empty.

Likely shape:

- Target patches for provider-native body knobs when the adapter target has a real field.
- Bridge-level lowering for opaque OpenCode provider options until each option has a typed native destination.

### `options(...)` Defaults

OpenCode behavior includes many default body/provider options:

- `store: false` for OpenAI, Azure, and GitHub Copilot.
- `promptCacheKey` / `prompt_cache_key` from session id for OpenAI, Azure, Venice, OpenRouter, and some opencode-hosted models.
- OpenRouter/Gateway usage inclusion.
- Google/Gemini `thinkingConfig` defaults.
- Anthropic/Kimi default `thinking` budget.
- Alibaba `enable_thinking` for reasoning models.
- GPT-5 default `reasoningEffort`, `reasoningSummary`, encrypted-content `include`, and `textVerbosity`.
- Baseten/opencode `chat_template_args.enable_thinking`.
- Z.ai/Zhipu `thinking.clear_thinking`.
- Gateway caching controls.

Native status:

- Partially represented by common `request.reasoning`, `request.cache`, and adapter-specific cache lowering.
- Most provider-native default knobs are not ported.

Likely shape:

- Adapter-local target patches where the target schema can express the option.
- New target fields only when the provider actually accepts them.
- Avoid a generic `providerOptions` escape hatch unless the bridge still needs temporary fallback behavior.

### Reasoning Variants

OpenCode behavior:

- `ProviderTransform.variants(...)` maps named effort presets (`low`, `high`, `max`, etc.) to provider-native option objects.
- The mapping differs by OpenAI, Azure, Anthropic, Bedrock, Gemini, Gateway, OpenRouter, Copilot, Groq, Mistral, xAI, and generic OpenAI-compatible providers.
- Some models deliberately return no variants despite advertising reasoning.

Native status:

- Common `ReasoningIntent` has `enabled`, `effort`, `summary`, and `encryptedContent`.
- Provider-specific target mappings are incomplete.

Likely shape:

- Keep the common intent small.
- Add provider/model target patches that translate `request.reasoning` into each adapter target's native fields.
- Add tests per provider family because invalid reasoning fields are common provider rejection causes.

### Sampling Defaults

OpenCode behavior:

- `temperature(model)` returns defaults for Qwen, Claude, Gemini, GLM, Minimax, and Kimi variants.
- `topP(model)` returns defaults for Qwen, Minimax, Gemini, and Kimi variants.
- `topK(model)` returns defaults for Minimax and Gemini.

Native status:

- Common `generation` supports `temperature` and `topP` only when the caller sets them.
- `topK` is not currently a common generation field.
- Model-specific defaults are not ported.

Likely shape:

- Request or target patches that fill unset generation fields for specific models.
- Add `topK` only when enough adapters support it or when a specific adapter target needs it.

### Small Model Options

OpenCode behavior:

- `smallOptions(model)` disables or minimizes reasoning for summarization/small requests.
- Examples: OpenAI `reasoningEffort: minimal/low`, Google `thinkingBudget: 0`, OpenRouter/Gateway reasoning disabled, Venice `disableThinking`.

Native status:

- Not ported.
- The native API does not currently distinguish regular requests from “small” internal requests at the LLM package boundary.

Likely shape:

- First define how OpenCode marks a request as small in `LLMRequest` or bridge metadata.
- Then use target patches keyed on that marker and provider/model.

### Interleaved Reasoning Field Variants

OpenCode behavior:

- Some OpenAI-compatible providers replay assistant reasoning under provider-native fields such as `reasoning_content` or `reasoning_details`.
- OpenRouter is excluded in the old transform for this path.

Native status:

- `reasoning_content` is covered for OpenAI-compatible Chat.
- Other field names like `reasoning_details` are not modeled yet.

Likely shape:

- Store the chosen field in model profile/native metadata.
- A prompt patch moves common reasoning parts into that provider-native field.
- The OpenAI-compatible target schema/lowerer emits the selected field.

## Suggested Order

1. Add target patches for high-confidence OpenAI/OpenAI-compatible defaults that already have target fields.
2. Add provider-family reasoning mapping tests before porting more variants.
3. Define the bridge marker for “small” requests before implementing `smallOptions` parity.
4. Keep provider option namespacing in the bridge until individual native destinations are known.
