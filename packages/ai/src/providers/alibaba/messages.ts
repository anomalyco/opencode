import { AlibabaMessages } from "../../protocols/alibaba-messages.js"
import { Provider } from "../../provider.js"
import { paths, provider, type Settings as LocatedSettings } from "./shared.js"

export type Settings = LocatedSettings<AlibabaMessages.OptionsInput>

export const messages = AlibabaMessages.api.configure({ capabilities: { reasoning: { signature: false } } })

export const model = Provider.entrypoint<Settings, AlibabaMessages.OptionsInput>(provider(messages, paths.anthropic))
