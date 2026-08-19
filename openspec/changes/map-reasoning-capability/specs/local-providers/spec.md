# Spec delta: local-providers (map-reasoning-capability)

## MODIFIED

### openai-compatible model discovery

- Discovery MUST read a `reasoning` boolean from each /v1/models entry and set
  the model's `capabilities.reasoning` from it, so a reasoning model declared
  on the host enables thinking-stream rendering without per-client config.
- An explicitly-configured provider-model capability still takes precedence
  over the discovered value.
