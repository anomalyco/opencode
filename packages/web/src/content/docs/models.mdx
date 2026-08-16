---
title: Models
description: Configuring an LLM provider and model.
---

OpenCode uses the [AI SDK](https://ai-sdk.dev/) and [Models.dev](https://models.dev) to support **75+ LLM providers** and it supports running local models.

---

## Providers

Most popular providers are preloaded by default. If you've added the credentials for a provider through the `/connect` command, they'll be available when you start OpenCode.

Learn more about [providers](/docs/providers).

---

## Select a model

Once you've configured your provider you can select the model you want by typing in:

```bash frame="none"
/models
```

---

## Recommended models

There are a lot of models out there, with new models coming out every week.

:::tip
Consider using one of the models we recommend.
:::

However, there are only a few of them that are good at both generating code and tool calling.

Here are several models that work well with OpenCode, in no particular order. (This is not an exhaustive list nor is it necessarily up to date):

- GPT 5.2
- GPT 5.1 Codex
- Claude Opus 4.5
- Claude Sonnet 4.5
- Minimax M2.1
- Gemini 3 Pro

---

## Set a default

To set one of these as the default model, you can set the `model` key in your
OpenCode config.

```json title="opencode.json" {3}
{
  "$schema": "https://opencode.ai/config.json",
  "model": "lmstudio/google/gemma-3n-e4b"
}
```

Here the full ID is `provider_id/model_id`. For example, if you're using [OpenCode Zen](/docs/zen), you would use `opencode/gpt-5.1-codex` for GPT 5.1 Codex.

If you've configured a [custom provider](/docs/providers#custom), the `provider_id` is key from the `provider` part of your config, and the `model_id` is the key from `provider.models`.

---

## Configure models

You can globally configure a model's options through the config.

```jsonc title="opencode.jsonc" {7-12,19-24}
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "openai": {
      "models": {
        "gpt-5": {
          "options": {
            "reasoningEffort": "high",
            "textVerbosity": "low",
            "reasoningSummary": "auto",
            "include": ["reasoning.encrypted_content"],
          },
        },
      },
    },
    "anthropic": {
      "models": {
        "claude-sonnet-4-5-20250929": {
          "options": {
            "thinking": {
              "type": "enabled",
              "budgetTokens": 16000,
            },
          },
        },
      },
    },
  },
}
```

Here we're configuring global settings for two built-in models: `gpt-5` when accessed via the `openai` provider, and `claude-sonnet-4-20250514` when accessed via the `anthropic` provider.
The built-in provider and model names can be found on [Models.dev](https://models.dev).

You can also configure these options for any agents that you are using. The agent config overrides any global options here. [Learn more](/docs/agents/#additional).

You can also define custom variants that extend built-in ones. Variants let you configure different settings for the same model without creating duplicate entries:

```jsonc title="opencode.jsonc" {6-21}
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "opencode": {
      "models": {
        "gpt-5": {
          "variants": {
            "high": {
              "reasoningEffort": "high",
              "textVerbosity": "low",
              "reasoningSummary": "auto",
            },
            "low": {
              "reasoningEffort": "low",
              "textVerbosity": "low",
              "reasoningSummary": "auto",
            },
          },
        },
      },
    },
  },
}
```

---

## Variants

Many models support multiple variants with different configurations. OpenCode ships with built-in default variants for popular providers.

### Built-in variants

OpenCode ships with default variants for many providers:

**Anthropic**:

- `high` - High thinking budget (default)
- `max` - Maximum thinking budget

**OpenAI**:

Varies by model but roughly:

- `none` - No reasoning
- `minimal` - Minimal reasoning effort
- `low` - Low reasoning effort
- `medium` - Medium reasoning effort
- `high` - High reasoning effort
- `xhigh` - Extra high reasoning effort

**Google**:

- `low` - Lower effort/token budget
- `high` - Higher effort/token budget

:::tip
This list is not comprehensive. Many other providers have built-in defaults too.
:::

### Custom variants

You can override existing variants or add your own:

```jsonc title="opencode.jsonc" {7-18}
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "openai": {
      "models": {
        "gpt-5": {
          "variants": {
            "thinking": {
              "reasoningEffort": "high",
              "textVerbosity": "low",
            },
            "fast": {
              "disabled": true,
            },
          },
        },
      },
    },
  },
}
```

### Cycle variants

Use the keybind `variant_cycle` to quickly switch between variants. [Learn more](/docs/keybinds).

---

## Loading models

When OpenCode starts up, it checks for models in the following priority order:

1. The `--model` or `-m` command line flag. The format is the same as in the config file: `provider_id/model_id`.

2. The model list in the OpenCode config.

   ```json title="opencode.json"
   {
     "$schema": "https://opencode.ai/config.json",
     "model": "anthropic/claude-sonnet-4-20250514"
   }
   ```

   The format here is `provider/model`.

3. The last used model.

4. The first model using an internal priority.
