# Prompt cache configuration

Configure prompt caching in `opencode.jsonc` using a top-level `cache` map. Keys are configured provider IDs, including custom IDs. Each provider has an array of rules. No configuration means no change to existing caching behavior.

```jsonc
{
  "cache": {
    "anthropic": [
      {
        "options": {
          "cache_control": { "type": "ephemeral", "ttl": "1h" },
        },
      },
      {
        "when": { "subagent": true },
        "options": {
          "cache_control": { "type": "ephemeral", "ttl": "5m" },
        },
      },
      {
        "when": { "agent": "research", "subagent": true },
        "options": {
          "cache_control": { "type": "ephemeral", "ttl": "1h" },
        },
      },
    ],
    "openai": [
      {
        "when": { "model": "gpt-5.4" },
        "options": { "prompt_cache_retention": "24h" },
      },
    ],
  },
}
```

Here Anthropic requests use one-hour caching, except subagents use five minutes. The `research` subagent uses one hour. OpenAI requests using the configured model ID `gpt-5.4` request extended retention. Switching providers resolves that provider's rules independently.

## Conditions and selection

`when` supports exact configured `agent` and `model` IDs and a boolean `subagent`. All specified conditions must match. Omitting a condition leaves it unrestricted; omitting `when` makes a default rule. `"true"` is a string and is rejected: use `true` or `false`.

Rule order does not matter. The winning rule must include the conditions of every other matching rule. The whole `options` object is selected without merging options from other rules.

For example, `{ "agent": "research" }` and `{ "subagent": true }` are incomparable when research runs as a subagent. Add `{ "agent": "research", "subagent": true }` to resolve that intersection. Duplicate matching conditions also fail, even if their options are identical or a more specific rule matches. Errors identify the provider, rule indexes, execution context, and config file when available.

A selected `options: {}` keeps existing behavior and prevents less-specific rules from overriding it. An unmatched request also keeps existing behavior. Neither case promises to disable a provider's implicit cache.

Across configuration documents, the highest-priority document defining a provider's rule array replaces that whole array. Other providers remain unchanged. An empty array clears lower-priority rules for that provider. Invalid cache syntax rejects the document with a configuration diagnostic rather than dropping conditions and broadening a rule.

## Agent execution

Each request uses its actual agent and resolved configured model/provider IDs. A child session created for subagent execution has `subagent: true`, including nested and resumed subagents. A normal fork has separate fork ancestry and is not a subagent. Agent definitions with `mode: "all"` therefore match according to the actual session, not their declared availability.

Children do not inherit the parent's selected rule. Titles, generation, and compaction use the same resolver with their actual request agent/model and the owning session's subagent context. Configuration is reread when preparing a request, so model switches and configuration reloads reevaluate the rules.

Debug logs include the selected provider/model, request kind, zero-based rule index, source document, and options.

## Supported options

- Anthropic `cache_control`: `type: "ephemeral"`, optional `ttl: "5m" | "1h"` (omitted means five minutes). Applies to OpenCode's automatic tool/system/message cache placements, preserving explicitly placed hints. Supported on the native Anthropic Messages, Google Vertex Messages, and Bedrock Mantle Messages routes. This does not enable Bedrock Converse or arbitrary Anthropic-compatible gateways.
- OpenAI `prompt_cache_retention`: `"in_memory" | "24h"`, on native OpenAI Chat and Responses routes. Values are forwarded without rounding. Known model incompatibilities are rejected locally; deployment aliases and account-specific restrictions remain subject to API validation. The API's rejection is surfaced without retrying with a different retention policy.

Do not apply OpenAI retention indiscriminately to every model: GPT-5.5 supports only `24h`; GPT-5.6 and later use `prompt_cache_options` instead, which this feature does not configure. Use a `model` condition to select a supported model. See the [OpenAI prompt caching guide](https://developers.openai.com/api/docs/guides/prompt-caching) and [Anthropic prompt caching guide](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) for current availability and billing.

Options cannot mix Anthropic and OpenAI controls. Unknown option names, invalid values, and explicitly unsupported routes fail rather than silently changing retention. Models without configurable caching continue to work when no nonempty rule applies. The native API options are interpreted by the AI layer; Core only selects the rule.

This feature does not manage Gemini explicit cache resources, provide arbitrary cache placement controls, or guarantee a cache hit. Existing provider/body overlays and plugin hooks remain advanced request customization mechanisms; avoid conflicting cache settings there.
