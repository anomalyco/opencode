import { App } from "../app/app"
import { CommandLoader } from "./loader"
import { CommandExecutor } from "./executor"
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
      
      const executor = new CommandExecutor(app)
      
      return {
        loader,
        executor,
      }
    },
    async (state) => {
      // Cleanup on shutdown
      state.loader.dispose()
    }
  )

  export async function list(): Promise<CustomCommand[]> {
    const { loader } = await state()
    return loader.getAllCommands()
  }

  export async function get(name: string): Promise<CustomCommand | undefined> {
    const { loader } = await state()
    return loader.getCommand(name)
  }

  export async function execute(
    commandName: string,
    args: string,
    sessionId: string,
    messageId: string
  ): Promise<any> {
    const { loader, executor } = await state()
    const command = loader.getCommand(commandName)
    if (!command) {
      throw new Error(`Command not found: ${commandName}`)
    }
    
    return executor.execute(command, args, sessionId, messageId)
  }
}