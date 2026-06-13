import { AuthOptions, type ProviderAuthOption } from "../route/auth-options"
import type { RouteDefaultsInput } from "../route/client"
import { ProviderID, type ModelID } from "../schema"
import * as OpenAICompatibleChat from "../protocols/openai-compatible-chat"

/**
 * Kimi K2.6 provider for OpenKimi.
 *
 * This provider connects to the Kimi Code CLI ACP bridge,
 * which provides an OpenAI-compatible local HTTP endpoint.
 *
 * The bridge must be running. To start it:
 *   cd /Users/julien/Documents/Odysseus
 *   venv/bin/python scripts/kimi_acp_openai_bridge.py --host 127.0.0.1 --port 8767 --work-dir /Users/julien/Documents/Odysseus
 *
 * Or use the Kimi CLI directly:
 *   ~/.kimi-code/bin/kimi acp
 *
 * Features:
 * - 256K context window
 * - Advanced reasoning with thinking mode
 * - Multimodal support (images, video)
 * - Strong tool calling capabilities
 */
export const id = ProviderID.make("kimi")

export type ModelOptions = RouteDefaultsInput &
  ProviderAuthOption<"optional"> & {
    readonly baseURL?: string
    readonly reasoning?: boolean
  }

export const routes = [OpenAICompatibleChat.route]

const auth = (options: ProviderAuthOption<"optional">) => AuthOptions.bearer(options, "KIMI_API_KEY")

export const configure = (input: ModelOptions = {}) => {
  const { apiKey: _, auth: _auth, baseURL, reasoning, ...rest } = input

  const route = OpenAICompatibleChat.route.with({
    ...rest,
    provider: id,
    endpoint: { baseURL: baseURL ?? "http://127.0.0.1:8767" },
    auth: auth(input),
  })

  return {
    id,
    model: (modelID: string | ModelID) => route.model({ id: modelID }),
    chat: (modelID: string | ModelID) => route.model({ id: modelID }),
    configure,
  }
}

export const provider = configure()
export const model = provider.model
export const chat = provider.chat

// Pre-configured model shortcuts for Kimi
export const kimiK26 = () => model("kimi-code/kimi-for-coding")
export const kimiK26Thinking = () => model("kimi-code/kimi-for-coding,thinking")
export const kimiK26Vision = () => model("kimi-code/kimi-for-coding")
export const kimiK26Search = () => model("kimi-code/kimi-for-coding")

// Local bridge endpoint
export const localBridgeEndpoint = "http://127.0.0.1:8767"
