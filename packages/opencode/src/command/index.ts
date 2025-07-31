import { App } from "../app/app"
import { CommandLoader } from "./loader"
import type { CustomCommand } from "./types"
import { CustomCommandSchema as _CustomCommandSchema } from "./types"

export namespace Command {
  // Re-export schema for API use
  export const CustomCommandSchema = _CustomCommandSchema

  // Create state using App.state pattern (consistent with Mode, Agent)
  const state = App.state(
    "command",
    async (app) => {
      const loader = new CommandLoader(app)
      await loader.loadCommands()
      await loader.watchForChanges()

      return {
        loader,
      }
    },
    async (state) => {
      // Cleanup on shutdown
      state.loader.dispose()
    },
  )

  export async function list(): Promise<CustomCommand[]> {
    const { loader } = await state()
    return loader.getAllCommands()
  }

  export async function get(name: string): Promise<CustomCommand | undefined> {
    const { loader } = await state()
    return loader.getCommand(name)
  }
}
