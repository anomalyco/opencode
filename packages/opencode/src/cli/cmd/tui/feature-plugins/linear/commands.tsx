import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { register } from "../../command/linear"

const id = "internal:linear-commands"

const tui: TuiPlugin = async (api) => {
  register(api)
}

const plugin: TuiPluginModule & { id: string } = {
  id,
  tui,
}

export default plugin
