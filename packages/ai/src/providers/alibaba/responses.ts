import { AlibabaResponses } from "../../protocols/alibaba-responses.js"
import { Provider } from "../../provider.js"
import { paths, provider, type Settings as LocatedSettings } from "./shared.js"

export type Settings = LocatedSettings<AlibabaResponses.OptionsInput>

export const responses = AlibabaResponses.api

export const model = Provider.entrypoint<Settings, AlibabaResponses.OptionsInput>(provider(responses, paths.compatible))
