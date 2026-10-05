# Gateway model discovery

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

No per-model definitions are necessary. An active API-key connection can supply the key instead of `settings.apiKey`. Provider headers are also used for discovery. Discovery is opt-in, runs at startup and refreshes every 30 seconds. A successful response replaces the discovered inventory, including when the gateway returns an empty list. An unsuccessful or malformed response retains the last successful catalog; changing the endpoint or credentials invalidates its cached metadata. Legacy configured models remain available when discovery fails.

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
| `reasoning_effort_levels`            | Exact supplier-supported reasoning choices.                         |
| `default_reasoning_effort`           | Default reasoning choice, when compatible with the advertised list. |
| `supported_modalities`               | Input modalities.                                                   |
| `supported_output_modalities`        | Output modalities.                                                  |

Unknown fields may be omitted or null. Empty arrays and `false` values are meaningful. A new discovered model has unknown token limits until the gateway provides them; input capacity is never substituted for total context. Existing catalog metadata supplies omitted values, and explicit local model configuration overrides discovery field by field.

OpenCode chooses the Responses interface when advertised, otherwise Chat Completions. An explicit configured provider or model package overrides this choice. A model advertising only unsupported endpoints is disabled. Omitting endpoint metadata preserves the existing package choice.

Reasoning levels become variants of the same model ID; no duplicate context-specific models or special invocation are required. Main agents and subagents resolve their selected model from the same catalog. Automatic compaction respects both the input ceiling and total context after reserving normal output capacity, retaining the existing estimation buffer. Output requests remain fitted to the remaining total context.
