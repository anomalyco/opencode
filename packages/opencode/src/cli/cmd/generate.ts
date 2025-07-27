import { Server } from "../../server/server"
import fs from "fs/promises"
import type { CommandModule } from "yargs"

export const GenerateCommand = {
  command: "generate",
  handler: async () => {
    const specs = await Server.openapi()
    const dir = "gen"
    await fs.rmdir(dir, { recursive: true }).catch(() => {})
    await fs.mkdir(dir, { recursive: true })
    process.stdout.write(JSON.stringify(specs, null, 2))
  },
} satisfies CommandModule
