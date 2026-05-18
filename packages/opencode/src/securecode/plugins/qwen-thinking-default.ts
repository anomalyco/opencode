// securecode qwen-thinking-default plugin.
//
// vLLM behind LiteLLM serves qwen3.x models with `enable_thinking=true` by
// default. The model then emits a `<think>...</think>` block as plain text in
// `choices[0].message.content`, and the gateway does not promote it to
// `message.reasoning_content`. opencode's openai-compatible provider only
// recognizes thinking when the gateway separates it (`message.reasoning_content`
// or `message.reasoning`), so the closing `</think>` tag bleeds into the
// `text` part of every assistant message — visible in the TUI and confusing
// downstream tooling. The fix is to default the chat-template flag to off
// for the qwen3.x family, which makes the model skip the thinking phase
// and reply directly. (The same gateway accepts `chat_template_kwargs.enable_thinking`
// per the vLLM Qwen3 chat template; we verified both the leak and the fix
// against `qwen3.6-35b-a3b-fp8` while resolving issue #100 / PR #104.)
//
// We deliberately key on `qwen3.` (with the dot) so the disable defaults to
// the `qwen3.x` line where the leak was observed and stays out of the way of
// `qwen3-coder-*` and `qwen-plus`/`qwq` variants whose thinking behavior we
// have not investigated. User-provided `chat_template_kwargs.enable_thinking`
// always wins — we only fill in the default when nothing was set explicitly.
//
// See https://github.com/acompany-develop/securecode/issues/112 (Pilot 1) for
// the broader plugin-migration tracker.

import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "securecode.qwen-thinking-default" })

const DISABLE_ENV = "SECURECODE_QWEN_THINKING_DEFAULT_DISABLE"

// Match `qwen3.<anything>` (case-insensitive). Excludes `qwen3-...` (dash
// rather than dot) and other qwen variants whose thinking behavior we have
// not tested.
const QWEN3_DOT_PATTERN = /^qwen3\./i

export function shouldApply(modelId: string | null | undefined): boolean {
  if (!modelId) return false
  return QWEN3_DOT_PATTERN.test(modelId)
}

export async function QwenThinkingDefaultPlugin(_input: PluginInput): Promise<Hooks> {
  if (process.env[DISABLE_ENV] === "1") {
    log.info("disabled via env", { env: DISABLE_ENV })
    return {}
  }

  return {
    "chat.params": async (input, output) => {
      const modelId = input?.model?.id
      if (!shouldApply(modelId)) return

      const existing = (output.options.chat_template_kwargs ?? {}) as Record<string, unknown>
      // User-set value wins. Only fill in the default when nothing was set.
      if ("enable_thinking" in existing) return

      output.options = {
        ...output.options,
        chat_template_kwargs: {
          ...existing,
          enable_thinking: false,
        },
      }
      log.info("applied default enable_thinking=false", { modelId })
    },
  }
}
