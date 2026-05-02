import { EOL } from "os"
import { Effect } from "effect"
import { Config } from "@/config/config"
import { effectCmd } from "../../effect-cmd"
import { InstanceRef } from "@/effect/instance-ref"
import { InstanceStore } from "@/project/instance-store"

export const ConfigCommand = effectCmd({
  command: "config",
  describe: "show resolved configuration",
  builder: (yargs) => yargs,
  handler: Effect.fn("Cli.debug.config")(function* () {
    const ctx = yield* InstanceRef
    if (!ctx) return
    const store = yield* InstanceStore.Service
    return yield* Effect.gen(function* () {
      const config = yield* Config.Service.use((cfg) => cfg.get())
      process.stdout.write(JSON.stringify(config, null, 2) + EOL)
    }).pipe(Effect.ensuring(store.dispose(ctx)))
  }),
})
