import { writePluginConfig } from "../../src/commands/handlers/plugin/add"

process.stdout.write("ready\n")
await Bun.stdin.text()
console.log(await writePluginConfig(process.argv[2]!, process.argv[3]!))
