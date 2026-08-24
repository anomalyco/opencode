# Spec delta: local-providers (harden-local-provider-runtime)

## MODIFIED

### Model discovery for openai-compatible local providers

- Discovery of a provider's models MUST complete (with degraded data if
  necessary) within the discovery timeout budget (2s per provider), even when
  the provider's control-plane endpoints (`/api/fit`) hang after TCP accept.
- On fit-fetch timeout or error, discovery falls back to the model-reported
  `context_length` chain (existing behavior for non-llama-skein backends).

### Global provider configuration writes

- Within one opencode process, all read-modify-write sequences against the
  global config's `provider` map MUST be linearized: a committed write is
  visible to every subsequently started sequence, and no committed write is
  lost.
- Applies to: local-provider auto-sync, `/connect`, `/disconnect`.

### Sidebar hardware meter

- A hardware sample MUST only be rendered for the provider it was requested
  from: when the active provider's baseURL changes, in-flight samples from the
  previous baseURL are discarded and their requests aborted.
