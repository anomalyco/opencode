import { spawnServiceContender } from "../../src/service-contender"

const [command, fixture, registration, mode, envJson] = process.argv.slice(2)
if (!command || !fixture || !registration || !mode) throw new Error("Missing spawner arguments")

const env = envJson ? (JSON.parse(envJson) as Record<string, string>) : undefined
spawnServiceContender(command, [fixture, registration, mode], env)
process.exit(0)
