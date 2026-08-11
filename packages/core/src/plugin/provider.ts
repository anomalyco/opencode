import { AnthropicPlugin } from "./provider/anthropic"
import type { PluginInternal } from "./internal"
import type { Scope } from "effect"

/**
 * Opviera ships exactly one provider integration.
 *
 * Upstream opencode registers ~30 here (OpenAI, Bedrock, Vertex, OpenRouter, Copilot, …). They are
 * removed rather than merely disabled: a config allow-list can be edited, but a plugin that is not
 * compiled into the binary cannot be re-enabled by any config file, env var, or flag.
 *
 * `AnthropicPlugin` stays because it is the SDK factory for `@ai-sdk/anthropic`, which is the wire
 * protocol the Opviera gateway speaks — it does not by itself grant access to Anthropic. Reaching
 * Anthropic directly would need a `baseURL` pointing there, and `enabled_providers` plus the
 * provisioned config pin that to the gateway.
 *
 * If you re-add a provider here, you have unlocked the CLI. That is the whole control.
 */
export const ProviderPlugins: PluginInternal.Plugin<PluginInternal.Requirements | Scope.Scope>[] = [AnthropicPlugin]
