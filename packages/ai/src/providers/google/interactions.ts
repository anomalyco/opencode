import { GoogleInteractions } from "../../protocols/google-interactions.js"
import { Provider } from "../../provider.js"
import { shared, type ConnectionSettings } from "./shared.js"

export type Settings = ConnectionSettings & GoogleInteractions.ProviderOptionsInput

export const model = Provider.entrypoint<Settings, GoogleInteractions.ProviderOptionsInput>(
  Provider.make({ ...shared, apis: [GoogleInteractions.api] }),
)
