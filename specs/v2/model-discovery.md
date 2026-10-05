# Gateway model discovery

This is a vendor-neutral optional extension to the OpenAI-style model list. Any OpenAI-compatible gateway can implement the fields below; the client needs no gateway-specific code, detection, authentication, model naming rules or supplier connections. OpenCode sends catalog and inference requests only to the configured gateway.

An OpenAI-compatible gateway can supply its model catalog, token limits and capabilities through `GET <baseURL>/models`. Enable discovery once on the provider:

```json
{
  "providers": {
    "gateway": {
      "settings": {
        "baseURL": "https://gateway.example/v1",
        "apiKey": "{env:GATEWAY_API_KEY}",
        "modelDiscovery": true
      }
    }
  }
}
```

No per-model definitions are necessary. An active API-key connection can supply the key instead of `settings.apiKey`. Provider headers are also used for discovery. Discovery is opt-in, runs at startup and refreshes every 30 seconds. A successful response authoritatively replaces the inventory of that opted-in provider, including when the gateway returns an empty list. Local metadata overrides cannot recreate a model absent from that inventory. Removed selections become unavailable for new main-agent and subagent requests; in-flight requests retain their resolved snapshot. Reappearing models become available with current metadata. Other providers, including ordinary free offerings, retain their existing discovery and access behavior. An unsuccessful or malformed response retains the last successful catalog; changing the endpoint or credentials invalidates its cached metadata. Before any successful discovery, ordinary configured models remain available when discovery fails; a changed endpoint or account likewise falls back to its own ordinary configuration, without inheriting the previous account's catalog.

The response is an OpenAI-style list, with metadata on each `data` item:

| Field                                | Meaning                                                             |
| ------------------------------------ | ------------------------------------------------------------------- |
| `id`                                 | Model ID used unchanged in requests.                                |
| `context_window`                     | Total combined input/output capacity.                               |
| `max_input_tokens`                   | Independent maximum input size.                                     |
| `max_output_tokens`                  | Independent maximum generated output.                               |
| `supported_endpoints`                | API routes, such as `/responses` and `/chat/completions`.           |
| `supports_function_calling`          | Whether tools can be advertised.                                    |
| `supports_parallel_function_calling` | Whether parallel tool calls are supported.                          |
| `supports_reasoning`                 | Whether reasoning controls are available.                           |
| `reasoning_effort_levels`            | Exact gateway-supported reasoning choices.                          |
| `default_reasoning_effort`           | Default reasoning choice, when compatible with the advertised list. |
| `supported_modalities`               | Input modalities.                                                   |
| `supported_output_modalities`        | Output modalities.                                                  |

Unknown fields may be omitted or null. Empty arrays and `false` values are meaningful. A new discovered model has unknown token limits until the gateway provides them; input capacity is never substituted for total context. Existing catalog metadata supplies omitted values, and explicit local model configuration overrides discovery field by field.

OpenCode chooses the Responses interface when advertised, otherwise Chat Completions. An explicit configured provider or model package overrides this choice. A model advertising only unsupported endpoints is disabled. Omitting endpoint metadata preserves the existing package choice.

Reasoning levels become variants of the same model ID; no duplicate context-specific models or special invocation are required. Main agents and subagents resolve their selected model from the same catalog. Automatic compaction respects both the input ceiling and total context after reserving normal output capacity, retaining the existing estimation buffer. Output requests remain fitted to the remaining total context.

Each model may also advertise `request_defaults`, containing a positive `output_token_budget` and a map named `output_token_budget_by_reasoning_effort`. For example:

```json
{
  "output_token_budget": 8192,
  "output_token_budget_by_reasoning_effort": {
    "low": 65536,
    "high": 65536,
    "xhigh": 65536,
    "max": 131072
  }
}
```

These are gateway-chosen defaults, not assertions about the supplier's maximum output. Unknown `max_output_tokens` remains unknown. The selected effective reasoning effort chooses its mapped budget, falling back to `output_token_budget`. The map does not create unsupported reasoning choices. Explicit provider, model or variant `settings.outputTokenBudget` overrides the advertised default. It is a Core generation policy and is not sent as a provider option.

The resolved budget controls both normal request output and compaction's response reservation. Known provider output limits and available context still constrain requests. Explicit request hooks can change the requested output, which is fitted to those constraints; use `settings.outputTokenBudget` for a choice that must also govern advance compaction decisions. Without advertised defaults or an explicit budget, the existing 32,000-token output fallback applies when the supplier maximum is unknown. Summary requests retain their existing 32,000-token cap.
