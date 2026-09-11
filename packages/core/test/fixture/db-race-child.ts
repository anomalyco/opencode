// signals readiness, waits for the barrier, then builds the database layer
// so N spawned processes race one database
import { Effect, Layer } from "effect"
import { existsSync, writeFileSync } from "fs"
import { Database } from "@opencode-ai/core/database/database"

const [filename, barrier, ready] = process.argv.slice(2)
writeFileSync(ready!, "up")
while (!existsSync(barrier!)) await new Promise((r) => setTimeout(r, 5))
await Effect.runPromise(Effect.scoped(Layer.build(Database.layerFromPath(filename!)).pipe(Effect.asVoid)))
