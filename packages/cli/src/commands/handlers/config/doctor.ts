import path from "path"
import { existsSync } from "fs"
import { Effect } from "effect"
import { Global } from "@bolt-ai/core/global"
import { UI } from "../../ui"
import { effectCmd } from "../../effect-cmd"

const GLOBAL_FILES = ["config.json", "bolt.json", "bolt.jsonc", "bolt.json", "bolt.jsonc"]

export const DoctorCommand = effectCmd({
  command: "doctor",
  describe: "explain which config files loaded, in what order, and which source won each key",
  handler: Effect.fn("Cli.config.doctor")(function* () {
    const { Config } = yield* Effect.promise(() => import("@/config/config"))
    const { ConfigDoctor } = yield* Effect.promise(() => import("@/config/doctor"))
    const svc = yield* Config.Service
    const origins = yield* svc.origins()
    const config = yield* svc.get()

    UI.println("Config sources in load order (later sources win):")
    if (!origins.length) UI.println("  (no config sources loaded)")
    origins.forEach((origin, index) => {
      const keys = Object.keys(origin.config).filter((key) => key !== "$schema" && key !== "plugin_origins")
      UI.println(`  ${index + 1}. ${origin.source}`)
      UI.println(`     sets: ${keys.length ? keys.join(", ") : "(nothing)"}`)
      if (origin.source !== Global.Path.config) return
      for (const file of GLOBAL_FILES) {
        const candidate = path.join(Global.Path.config, file)
        if (existsSync(candidate)) UI.println(`     includes ${candidate}`)
      }
    })

    UI.empty()
    UI.println("Winning source per key:")
    const won = ConfigDoctor.winners(origins)
    const visible = Object.fromEntries(
      Object.entries(config).filter(
        (entry) => entry[0] !== "$schema" && entry[0] !== "plugin_origins" && entry[1] !== undefined,
      ),
    )
    const paths = ConfigDoctor.leaves(visible).sort()
    if (!paths.length) UI.println("  (empty config)")
    for (const item of paths) {
      UI.println(`  ${item} <- ${ConfigDoctor.winner(won, item) ?? "(runtime default)"}`)
    }

    const instructions = ConfigDoctor.contributors(origins, "instructions")
    if (instructions.length > 1) {
      UI.empty()
      UI.println(`Note: "instructions" concatenates across sources instead of replacing:`)
      for (const source of instructions) UI.println(`  ${source}`)
    }
  }),
})
