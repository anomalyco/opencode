import { Effect } from "effect"
import { effectCmd, fail } from "../effect-cmd"
import { UI } from "../ui"
import { PatternDetection } from "@/pattern-detection/pattern-detection"

export const PatternDetectionCommand = effectCmd({
  command: "pattern-detection",
  describe: "configure loop/repetition detection for autonomous agent runs",
  instance: false,
  builder: (yargs) =>
    yargs
      .option("enable", { type: "boolean", describe: "enable pattern detection", conflicts: "disable" })
      .option("disable", { type: "boolean", describe: "disable pattern detection", conflicts: "enable" })
      .option("reset", { type: "boolean", describe: "clear detection history" })
      .option("max-repetitions", { type: "number", describe: "repetitions before triggering (default: 5)" })
      .option("time-window", { type: "number", describe: "time window in seconds (default: 300)" })
      .option("similarity", { type: "number", describe: "similarity threshold 0-1 (default: 0.7)" }),
  handler: (args) =>
    Effect.gen(function* () {
      const svc = yield* PatternDetection.Service

      if (args.reset) {
        yield* svc.reset()
        UI.println("pattern detection history cleared")
        return
      }

      if (!args.enable && !args.disable && args["max-repetitions"] === undefined && args["time-window"] === undefined && args.similarity === undefined) {
        yield* fail("specify --enable, --disable, --reset, or a setting to update")
      }

      const updates: Parameters<typeof svc.updateConfig>[0] = {}
      if (args.enable) updates.enabled = true
      if (args.disable) updates.enabled = false
      if (args["max-repetitions"] !== undefined) updates.maxRepetitions = args["max-repetitions"]
      if (args["time-window"] !== undefined) updates.timeWindow = args["time-window"] * 1000
      if (args.similarity !== undefined) updates.similarityThreshold = args.similarity

      yield* svc.updateConfig(updates)
      UI.println(`pattern detection ${args.enable ? UI.Style.TEXT_SUCCESS_BOLD + "enabled" : args.disable ? UI.Style.TEXT_DIM + "disabled" : "updated"}${UI.Style.TEXT_NORMAL}`)
    }).pipe(Effect.provide(PatternDetection.layer)),
})
