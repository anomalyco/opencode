import { MetaResponses } from "../../protocols/meta-responses.js"
import { Provider } from "../../provider.js"
import type { OpenResponsesProviderOptionsInput } from "../open-responses-options.js"
import { shared, type Settings } from "./shared.js"

export type { Settings } from "./shared.js"

export const responses = MetaResponses.api

export const model = Provider.entrypoint<Settings, OpenResponsesProviderOptionsInput>(
  Provider.make({ ...shared, apis: [responses] }),
)
