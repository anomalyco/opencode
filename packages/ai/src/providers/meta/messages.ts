import type { AnthropicMessages } from "../../protocols/anthropic-messages.js"
import { MetaMessages } from "../../protocols/meta-messages.js"
import { Provider } from "../../provider.js"
import { shared, type Settings } from "./shared.js"

export type { Settings } from "./shared.js"

export type OptionsInput = Pick<
  AnthropicMessages.OptionsInput,
  "thinking" | "effort" | "outputConfig" | "output_config" | "serviceTier" | "service_tier" | "metadata"
> & { readonly [key: string]: unknown }

export const messages = MetaMessages.api.configure({
  options: { providerOptions: { thinking: { type: "adaptive", display: "omitted" } } },
})

export const model = Provider.entrypoint<Settings, OptionsInput>(Provider.make({ ...shared, apis: [messages] }))
