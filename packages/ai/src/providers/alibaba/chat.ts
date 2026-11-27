import { AlibabaChat } from "../../protocols/alibaba-chat.js"
import { Provider } from "../../provider.js"
import { paths, provider, type Settings as LocatedSettings } from "./shared.js"

export type Settings = LocatedSettings<AlibabaChat.OptionsInput>

export const chatCompletions = AlibabaChat.api.configure({
  models: { "*": { cache: { markers: true, auto: "none" } }, "qwen*": { cache: { auto: "qwen" } } },
})

export const model = Provider.entrypoint<Settings, AlibabaChat.OptionsInput>(
  provider(chatCompletions, paths.compatible),
)
