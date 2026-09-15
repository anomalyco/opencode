import { Effect } from "effect"
import { layer, migrate } from "./database"

await Effect.runPromise(migrate().pipe(Effect.provide(layer)))
