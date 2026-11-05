# OpenCode Unlimited (OCU) — Phase 1

OCU is an additive routing layer around OpenCode. OpenCode remains the agent/runtime; OCU selects compatible cloud or local model endpoints and provides a single OpenAI-compatible API.

## Phase 1 scope

- Dependency-free Node.js HTTP gateway.
- OpenAI-compatible `/v1/models` and `/v1/chat/completions`.
- Priority-based or adaptive provider selection using observed latency and recent failures.
- Per-provider request, success, failure and latency metrics via `GET /ocu/status`.
- Pre-response fallback and in-memory cooldown.
- In-memory cooldown for rate limits, server errors and connection failures.
- Optional inbound bearer authentication.
- Loopback-only default binding.
- Example provider and OpenCode v2 configuration.
- Adaptive routing using observed latency and recent failures.
- Provider diagnostics at `GET /ocu/status`.
- Initial Android runtime scripts for Termux (no root/proot required).
- Tests using Node's built-in test runner.

This is a foundation, not a production-hardened service. Cooldowns are in memory and reset on restart. Persistent usage accounting, a UI, Android packaging and automatic provider discovery are out of scope for this phase.

## Requirements

Node.js 20 or newer (built-in `fetch` required).

## Run

```sh
cp ocu/gateway/config.example.json ocu/gateway/config.json
export OCU_CONFIG="$PWD/ocu/gateway/config.json"
node ocu/gateway/gateway.mjs
```

The gateway listens on `127.0.0.1:8787` by default. Set each provider's credential through the environment variable named by `apiKeyEnv`; do not put secrets in configuration files or commit them.

To bind beyond loopback, set `OCU_HOST` and `OCU_GATEWAY_KEY`. External binding without a gateway key is rejected. Clients must send `Authorization: Bearer <OCU_GATEWAY_KEY>`.

## API

- `GET /health`
- `GET /ocu/status` (provider diagnostics; protect the gateway with a key when exposed)
- `GET /v1/models`
- `POST /v1/chat/completions`

Set `routing.mode` to `priority` or `adaptive`. In adaptive mode, OCU ranks providers using configured priority, observed latency (EWMA) and consecutive failures. Use `ocu/auto` to try eligible providers in the resulting order. A specific alias restricts routing to providers that publish that alias. Fallback is possible only before an upstream success response starts. Once streaming begins, switching providers is unsafe.

## Android (Termux)

See `ocu/android/README.md`. Run `bash ocu/android/setup-termux.sh` from the repository root, configure `~/.config/ocu/config.json`, then start with `bash ocu/android/run-termux.sh`.

## OpenCode

See `opencode.example.jsonc` for an OpenCode v2 provider example.

## Tests

```sh
node --test ocu/gateway/test-gateway.mjs
```

## Security notes

- Loopback binding by default; external binding requires an inbound gateway key.
- Provider credentials are read from environment variables.
- Request bodies are size-limited.
- Logs do not include request bodies or authorization headers.
- TLS is not provided; use a trusted TLS reverse proxy before exposing the gateway on an untrusted network.
- Treat provider configuration and model endpoints as trusted administrative input.
