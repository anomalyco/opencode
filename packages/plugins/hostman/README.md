# Hostman

An opt-in OpenCode plugin that registers the [Hostman AI Gateway](https://hostman.com/docs/ai-services/ai-gateway/) as the `hostman` provider. The gateway is an OpenAI-compatible endpoint (`Chat Completions`, `/models`), so the plugin reuses the native `@opencode/ai/providers/openai-compatible` package and adds live model discovery on top of it.

Models are addressed as `hostman/<provider>/<model>`, for example `hostman/openai/gpt-5-mini`. The full gateway id (`openai/gpt-5-mini`) is sent back to the gateway verbatim as the `model` field, matching the `provider/model` naming the gateway expects.

## Prerequisites

Create an AI Gateway API key in the Hostman dashboard: **AI Services → AI Gateway → Create Key**. Gateway keys are separate from account keys, are billed per key, and carry their own limits. The list of available models is visible there as well.

## Install

Install from Git:

```sh
opencode plugin add 'git+https://github.com/anomalyco/opencode.git#path:packages/plugins/hostman'
```

The URL selects the `hostman` directory and uses the repository's default branch, so no explicit branch name is needed. Installation is Git-only.

The plugin exports `index.ts` directly. There is no build step or installation hook.

For local development, add the directory to `plugins` in `opencode.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [{ "package": "./packages/plugins/hostman" }],
}
```

## Connect

Provide the API key in one of two ways:

- Environment variable: `export HOSTMAN_API_KEY=...`
- Interactive: open `/connect`, select `hostman`, and choose *Manually enter API Key*.

A key stored through `/connect` takes precedence over the environment variable. The `hostman` provider only appears once a connection exists; without a key it stays hidden instead of failing requests with 401.

## Use

- Open `/models` and pick a `hostman/...` model, or
- select one for a session: `opencode --model hostman/openai/gpt-5-mini`, or set it as the default in `opencode.jsonc`.

## How it works

- **Provider.** The plugin registers `hostman` with the native `openai-compatible` package and `settings.baseURL` defaulting to `https://ai-api.hostman.com/v1`.
- **Integration.** The plugin registers the `hostman` integration with an `env` method (the key's variable name) and a manual key method for `/connect`. The gateway key is resolved from the active connection and attached as `Bearer` by the provider package; the plugin never embeds the key in provider settings.
- **Discovery.** On load, after a `provider.updated` event (for example when a credential is stored or removed through `/connect`), and every refresh tick the plugin calls `GET {baseURL}/models` with the active key and publishes the result as the provider's model inventory. A credential change during an in-flight fetch queues a rerun, and a response fetched for a connection that is no longer active is dropped. On failure it keeps the last good inventory and logs a warning. Non-chat workloads are filtered out of the chat list: an entry's `mode` field is authoritative when present (only `chat` is kept), and entries without a `mode` are matched against the non-chat id pattern (`embed*`, `whisper*`, `transcribe*`, `tts*`, `speech*`, `audio*`, `music*`, `dall-e*`, `sora*`, `flux*`, `nano-banana*`, `image*`, `video*`, `wan*`, `seedance*`, `seedream*`, `veo*`, `kling*`, `hailuo*`, `runway*`).
- **Model mapping.** Each gateway id becomes one model: the id is kept verbatim, `name` comes from the gateway when provided, tool support is assumed (`tools: true`), and context/output limits are read from `max_input_tokens`/`max_output_tokens`-style fields when the gateway reports them (defaults: 200k context, 32k output). Input modalities are text-only unless the gateway reports `input_modalities` (flat or under `architecture`). Per-model cost is left empty because the gateway bills at the key level.

## Options

Plugin options come from the `options` object of the configured entry (a nested `hostman` object is also merged in, with flat keys taking precedence):

| Option | Type | Default | Environment fallback |
| --- | --- | --- | --- |
| `baseURL` | string | `https://ai-api.hostman.com/v1` | `HOSTMAN_BASE_URL` |
| `envVar` | string | `HOSTMAN_API_KEY` | `HOSTMAN_ENV_VAR` |
| `refreshIntervalMs` | number | `600000` (minimum `60000`) | — |

```jsonc
{
  "plugins": [
    {
      "package": "./packages/plugins/hostman",
      "options": {
        "baseURL": "https://ai-api.hostman.com/v1",
        "envVar": "HOSTMAN_API_KEY",
        "refreshIntervalMs": 600000
      }
    }
  ]
}
```

## Customizing models

Standard `providers.hostman` configuration overlays apply on top of the discovered catalog:

```jsonc
{
  "providers": {
    "hostman": {
      "models": {
        "openai/gpt-5-mini": { "name": "GPT-5 Mini", "limit": { "context": 400000 } },
        "openai/gpt-5-nano": { "disabled": true }
      }
    }
  }
}
```

This also works to re-enable a model that discovery filtered out, or to point individual models at a different endpoint.

## Troubleshooting

- **`hostman` is not listed.** No active connection exists yet. Set `HOSTMAN_API_KEY` (then restart or reload) or store a key via `/connect`.
- **`model discovery failed: GET /models answered HTTP 401` in the server log.** The key is invalid or lacks gateway access. The last good inventory keeps working until the next successful fetch.
- **A model you expect is missing.** Check the gateway's model list in the dashboard; it may have been filtered as non-chat (a `mode` other than `chat`, or a non-chat id pattern match). Add it explicitly under `providers.hostman.models`.
- **A model rejects image attachments.** Discovery declares text-only input unless the gateway reports `input_modalities`. Set the model's `capabilities.input` under `providers.hostman.models` to re-enable them.
- **A model fails on tool calls.** Discovery assumes tool support for every listed model. Disable the model with `"disabled": true` if the gateway rejects tool requests for it.
