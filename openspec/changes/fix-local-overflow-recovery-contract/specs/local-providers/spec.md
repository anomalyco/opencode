# Spec delta: local-providers (fix-local-overflow-recovery-contract)

## MODIFIED Requirements

### Requirement: Overflow recovery matches the backend's real error contract
opencode SHALL recognise a local prompt-overflow rejection by the signal
llama-skein actually emits: HTTP 413 with `error.type =
"exceed_context_size_error"` and `error.code = "prompt_over_max_safe_ctx"`.
This is distinct from, and does not replace, the separate
`context_too_large` signal (a different failure mode: model failed to
load). The accepted type/code SHALL derive from a single shared constant,
so a rename in one repo cannot silently disable recovery in the other.

#### Scenario: a real llama-skein prompt-overflow body is recognised
- **WHEN** a local backend responds 413 with `error.type =
  "exceed_context_size_error"` and `error.code =
  "prompt_over_max_safe_ctx"`
- **THEN** opencode recognises it as a prompt-overflow recovery case, not
  as an unrecognised/opaque error

### Requirement: A prompt-overflow trims the prompt; it never grows the backend
On `prompt_over_max_safe_ctx`, opencode SHALL NOT PATCH the backend's
`ctx_size` in response to this error class: the prompt is too large for the
host, and on a VRAM-tight host no larger `ctx_size` can load. Backend
`ctx_size` patching remains permitted only for the distinct
model-misconfigured overflow class (`context_too_large`), unchanged from
existing behavior.

#### Scenario: a prompt-overflow 413 never patches backend ctx_size
- **WHEN** a prompt-overflow 413 (`exceed_context_size_error` /
  `prompt_over_max_safe_ctx`) is received
- **THEN** no `patchConfigModel` call is made

#### Scenario: a model-misconfigured 413 still patches and retries
- **WHEN** a `context_too_large` 413 is received (model failed to load,
  configured ctx exceeds available memory)
- **THEN** opencode patches the backend's `ctx_size` down and retries the
  same request once, as before

### Requirement: The ceiling comes from an authoritative, machine-readable source
The ceiling SHALL be read from the `X-Skein-Max-Safe-Ctx` response header,
falling back to `/api/fit` `max_safe_ctx`. It SHALL NOT be parsed from the
human-readable error message, and recovery SHALL NOT require `max_fit_ctx`
— that field is legitimately absent for a configured model whose weights
exceed the host's safety budget, and treating its absence as fatal disables
recovery exactly when it is needed.

#### Scenario: header present
- **WHEN** the 413 response includes `X-Skein-Max-Safe-Ctx: 74711`
- **THEN** opencode uses 74711 as the ceiling without calling `/api/fit`

#### Scenario: header absent, fit available
- **WHEN** the 413 response has no `X-Skein-Max-Safe-Ctx` header
- **THEN** opencode calls `/api/fit` for that model and uses its
  `max_safe_ctx` as the ceiling

#### Scenario: neither source available
- **WHEN** the header is absent and the `/api/fit` call fails or omits
  `max_safe_ctx`
- **THEN** opencode surfaces the overflow rather than guessing a ceiling

## ADDED Requirements

### Requirement: An overflow corrects the stale limit in place
On a prompt-overflow 413 opencode SHALL update the affected model's
in-memory `limit.context` to the authoritative ceiling from the response,
so a session that started with a stale (too large) limit self-heals
without a restart.

#### Scenario: the cached limit is corrected after a prompt-overflow 413
- **WHEN** a model's cached `limit.context` is 90112 and a prompt-overflow
  413 reports ceiling 74711
- **THEN** the model's `limit.context` becomes 74711 for subsequent
  requests in the same session, without a restart

### Requirement: Discovery never silently adopts a budget above the enforced wall
The `/api/fit` probe SHALL have its own timeout, independent of the
`/v1/models` fetch, so a slow fit probe cannot cause a silent downgrade to
the larger `context_length`. When fit is unavailable and the reported
`context_length` exceeds a previously-known context value for that model,
opencode SHALL prefer the conservative known value and log the
substitution at WARN.

#### Scenario: fit probe timeout is independent of the models fetch
- **WHEN** `/api/fit` never responds but `/v1/models` responds normally
- **THEN** model discovery completes using the `/v1/models` data, bounded
  by fit's own timeout rather than hanging indefinitely

#### Scenario: fit unavailable, reported context exceeds a known value
- **WHEN** fit is unavailable for a model and the reported `context_length`
  is larger than a previously-known context value for that model
- **THEN** opencode keeps the smaller, previously-known value and logs a
  WARN, rather than silently adopting the larger reported value
