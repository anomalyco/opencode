import { Server } from "../../server/server"
import type { CommandModule } from "yargs"

export const GenerateCommand = {
  command: "generate",
  handler: async () => {
    const specs = await Server.openapi()
    process.stdout.write(JSON.stringify(specs, null, 2))
  },
} satisfies CommandModule
