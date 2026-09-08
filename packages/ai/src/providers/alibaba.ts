import type { ProviderPackage } from "../provider-package.js"
import { AlibabaChat } from "../protocols/alibaba-chat.js"
import { AlibabaMessages } from "../protocols/alibaba-messages.js"
import { AlibabaResponses } from "../protocols/alibaba-responses.js"
import { AuthOptions, type AtLeastOne, type ProviderAuthOption } from "../route/auth-options.js"
import { Route, type RouteDefaultsInput } from "../route/client.js"
import { Endpoint } from "../route/endpoint.js"
import { Framing } from "../route/framing.js"
import { ProviderID, ToolDefinition, type ModelID } from "../schema/index.js"

export const id = ProviderID.make("alibaba")

export type Region =
  | "ap-southeast-1"
  | "cn-beijing"
  | "cn-hongkong"
  | "us-east-1"
  | "eu-central-1"
  | "ap-northeast-1"
  | (string & {})
export type ChatOptionsInput = AlibabaChat.OptionsInput
export type MessagesOptionsInput = AlibabaMessages.OptionsInput
export type ResponsesOptionsInput = AlibabaResponses.OptionsInput

type Location = AtLeastOne<{
  readonly region: Region
  /** Overrides the selected API's complete base URL, including its version prefix. */
  readonly baseURL: string
}> & { readonly workspaceID?: string }

export type Config = Location &
  Omit<RouteDefaultsInput, "providerOptions"> &
  ProviderAuthOption<"optional"> & {
    readonly providerOptions?: ChatOptionsInput | MessagesOptionsInput | ResponsesOptionsInput
  }
export type Settings<Options = ChatOptionsInput> = Location &
  ProviderPackage.Settings & {
    readonly apiKey?: string
    readonly providerOptions?: Options
  }

const sharedHosts = new Map<string, string>([
  ["ap-southeast-1", "dashscope-intl.aliyuncs.com"],
  ["cn-beijing", "dashscope.aliyuncs.com"],
  ["cn-hongkong", "cn-hongkong.dashscope.aliyuncs.com"],
  ["us-east-1", "dashscope-us.aliyuncs.com"],
])
const chatRoute = Route.make({
  id: "alibaba-chat",
  provider: id,
  providerMetadataKey: "alibaba",
  protocol: AlibabaChat.protocol,
  endpoint: Endpoint.path("/chat/completions"),
  framing: Framing.sse,
})
const messagesRoute = Route.make({
  id: "alibaba-messages",
  provider: id,
  providerMetadataKey: "alibaba",
  protocol: AlibabaMessages.protocol,
  endpoint: Endpoint.path("/messages"),
  framing: Framing.sse,
  headers: () => ({ "anthropic-version": "2023-06-01" }),
})
const responsesRoute = Route.make({
  id: "alibaba-responses",
  provider: id,
  providerMetadataKey: "alibaba",
  protocol: AlibabaResponses.protocol,
  endpoint: Endpoint.path("/responses"),
  framing: Framing.sse,
})

export const routes = [chatRoute, messagesRoute, responsesRoute]

export const configure = (input: Config) => {
  const { apiKey: _apiKey, auth: _auth, region: _region, workspaceID: _workspaceID, baseURL, ...rest } = input
  const host = baseURL === undefined ? requireHost(input) : undefined
  const defaults = { ...rest, auth: AuthOptions.bearer(input, ["DASHSCOPE_API_KEY", "ALIBABA_API_KEY"]) }
  const compatible = { ...defaults, endpoint: { baseURL: baseURL ?? `https://${host}/compatible-mode/v1` } }
  const chat = (modelID: string | ModelID) =>
    chatRoute.with(compatible).model<ChatOptionsInput>({ id: modelID, compatibility: AlibabaChat.compatibility })
  const messages = (modelID: string | ModelID) =>
    messagesRoute
      .with({
        ...defaults,
        endpoint: { baseURL: baseURL ?? `https://${host}/apps/anthropic/v1` },
      })
      .model<MessagesOptionsInput>({ id: modelID, compatibility: { requireSignature: false } })
  const responses = (modelID: string | ModelID) =>
    responsesRoute.with(compatible).model<ResponsesOptionsInput>({ id: modelID })
  return { id, model: chat, chat, messages, responses, configure }
}

function requireHost(input: Location) {
  if (input.region === undefined) throw new Error("Alibaba requires region or baseURL")
  if (input.workspaceID !== undefined) return `${input.workspaceID}.${input.region}.maas.aliyuncs.com`
  const host = sharedHosts.get(input.region)
  if (host === undefined) throw new Error(`Alibaba region ${input.region} requires workspaceID or baseURL`)
  return host
}

export const provider = { id, configure }

export const model: ProviderPackage.Definition<Settings, ChatOptionsInput>["model"] = (modelID, settings) =>
  fromSettings(settings).chat(modelID)
export const messagesModel: ProviderPackage.Definition<
  Settings<MessagesOptionsInput>,
  MessagesOptionsInput
>["model"] = (modelID, settings) => fromSettings(settings).messages(modelID)
export const responsesModel: ProviderPackage.Definition<
  Settings<ResponsesOptionsInput>,
  ResponsesOptionsInput
>["model"] = (modelID, settings) => fromSettings(settings).responses(modelID)

function fromSettings(settings: Settings<ChatOptionsInput | MessagesOptionsInput | ResponsesOptionsInput>) {
  const common = {
    apiKey: settings.apiKey,
    workspaceID: settings.workspaceID,
    headers: settings.headers,
    http: settings.body === undefined ? undefined : { body: { ...settings.body } },
    providerOptions: settings.providerOptions,
  }
  if (settings.baseURL !== undefined)
    return configure({ ...common, baseURL: settings.baseURL, region: settings.region })
  if (settings.region !== undefined) return configure({ ...common, region: settings.region })
  throw new Error("Alibaba requires region or baseURL")
}

export const webSearch = () => hostedTool("web_search", "Search the web with Alibaba's hosted search tool.")
export const webExtractor = () => hostedTool("web_extractor", "Extract web page content with Alibaba's hosted tool.")
export const codeInterpreter = () => hostedTool("code_interpreter", "Execute code with Alibaba's hosted interpreter.")

function hostedTool(type: string, description: string) {
  return ToolDefinition.make({
    name: type,
    description,
    inputSchema: { type: "object", properties: {} },
    native: { alibaba: { type } },
  })
}

export * as Alibaba from "./alibaba.js"
