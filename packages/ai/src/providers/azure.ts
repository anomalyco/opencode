import { Provider } from "../provider.js"
import { MediaRoute } from "../route/media.js"
import { mergeTransport, type ModelID, type ProviderOptions, type RequestOptions } from "../schema/index.js"
import { OpenAIImages } from "../protocols/openai-images.js"
import { OpenAIEmbeddings } from "../protocols/openai-embeddings.js"
import type { OpenAIProviderOptionsInput } from "./openai-options.js"
import { chatCompletions } from "./azure/chat.js"
import { responses } from "./azure/responses.js"
import { auth, authentication, connection, endpoint, id, type Connection, type Settings } from "./azure/shared.js"

export type { MessagesSettings, Settings } from "./azure/shared.js"
export { model as chatModel } from "./azure/chat.js"
export { azureMessages, model as messagesModel } from "./azure/messages.js"
export { model, model as responsesModel } from "./azure/responses.js"

/** Azure OpenAI. Models need the resource's URL: `azure.with({ baseURL })`, or the entrypoints' `resourceName`. */
export const azure = Provider.make({ id, auth: authentication(), apis: [responses, chatCompletions] })

/** Connection settings for Azure's media models. Language models come from the entrypoints. */
export type Config = Connection &
  Omit<RequestOptions, "providerOptions"> & {
    readonly providerOptions?: OpenAIProviderOptionsInput
  }

export const media = (input: Config) => {
  const image = (modelID: string | ModelID, providerOptions?: ProviderOptions) => {
    const target = endpoint(input, modelID)
    const transport = mergeTransport(input, { http: { query: target.query } })
    const media = MediaRoute.deployment({ ...transport, baseURL: target.baseURL }, auth(input))
    return OpenAIImages.model({ ...media, id: modelID, provider: id, providerOptions })
  }

  const embedding = (modelID: string | ModelID, providerOptions?: ProviderOptions) =>
    OpenAIEmbeddings.route
      .with({
        provider: id,
        endpoint: endpoint(input, modelID),
        auth: auth(input),
        ...mergeTransport(input),
      })
      .model({ id: modelID, providerOptions })

  return { id, image, embedding }
}

const config = ({ body, headers, ...settings }: Settings): Config => {
  const resolved = connection(settings)
  return {
    ...resolved.input,
    headers,
    http: body === undefined ? undefined : { body },
    providerOptions: resolved.rest,
  }
}

export const imageModel = (modelID: string, settings: Settings) => {
  const input = config(settings)
  return media(input).image(modelID, input.providerOptions)
}
export const embeddingModel = (modelID: string, settings: Settings) => {
  const input = config(settings)
  return media(input).embedding(modelID, input.providerOptions)
}
