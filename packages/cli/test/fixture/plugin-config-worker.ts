import { writePluginConfig } from "../../src/commands/handlers/plugin/add"

await writePluginConfig(process.argv[2]!, process.argv[3]!)
