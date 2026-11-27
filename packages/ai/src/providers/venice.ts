import { VeniceChat } from "../protocols/venice-chat.js"
import { Provider } from "../provider.js"
import type { OpenResponsesProviderOptionsInput } from "./open-responses-options.js"
import { responses } from "./venice/responses.js"
import { shared, type Settings as SharedSettings } from "./venice/shared.js"

export type ChatOptionsInput = VeniceChat.OptionsInput
export type Settings<Options = ChatOptionsInput> = SharedSettings<Options>

export const venice = Provider.make({ ...shared, apis: [VeniceChat.api, responses] })

export const model = Provider.entrypoint<Settings, ChatOptionsInput>(venice)
export const responsesModel = Provider.entrypoint<
  Settings<OpenResponsesProviderOptionsInput>,
  OpenResponsesProviderOptionsInput
>(venice, "responses")

export * as Venice from "./venice.js"
