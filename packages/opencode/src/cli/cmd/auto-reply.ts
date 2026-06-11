import { Effect } from "effect"
import { effectCmd, fail } from "../effect-cmd"
import { UI } from "../ui"
import { AutoReply } from "@/auto-reply/auto-reply"

export const AutoReplyToggleCommand = effectCmd({
  command: "auto-reply",
  describe: "enable or disable automatic replies when the LLM pauses for input",
  instance: false,
  builder: (yargs) =>
    yargs
      .option("enable", {
        type: "boolean",
        describe: "enable auto-reply",
        conflicts: "disable",
      })
      .option("disable", {
        type: "boolean",
        describe: "disable auto-reply",
        conflicts: "enable",
      })
      .option("status", {
        type: "boolean",
        describe: "show current auto-reply configuration",
      })
      .option("phrases", {
        type: "string",
        describe: "comma-separated list of reply phrases to use",
      })
      .option("max-responses", {
        type: "number",
        describe: "maximum number of auto-replies per session",
      })
      .option("delay", {
        type: "number",
        describe: "delay in milliseconds before sending auto-reply",
      }),
  handler: (args) =>
    Effect.gen(function* () {
      const svc = yield* AutoReply.Service

      if (args.status) {
        const cfg = yield* svc.getConfig()
        UI.println(`auto-reply: ${cfg.enabled ? UI.Style.TEXT_SUCCESS_BOLD + "enabled" : UI.Style.TEXT_DIM + "disabled"}${UI.Style.TEXT_NORMAL}`)
        UI.println(`  phrases:       ${cfg.phrases.join(", ")}`)
        UI.println(`  triggers:      ${cfg.triggerPhrases.join(", ")}`)
        UI.println(`  max-responses: ${cfg.maxResponses}`)
        UI.println(`  delay:         ${cfg.responseDelay}ms`)
        UI.println(`  cooldown:      ${cfg.cooldownPeriod / 1000}s`)
        return
      }

      if (!args.enable && !args.disable && !args.phrases && args["max-responses"] === undefined && args.delay === undefined) {
        yield* fail("specify --enable, --disable, --status, or a setting to update")
      }

      const updates: Parameters<typeof svc.updateConfig>[0] = {}

      if (args.enable) updates.enabled = true
      if (args.disable) updates.enabled = false
      if (args.phrases) updates.phrases = args.phrases.split(",").map((s: string) => s.trim()).filter(Boolean)
      if (args["max-responses"] !== undefined) updates.maxResponses = args["max-responses"]
      if (args.delay !== undefined) updates.responseDelay = args.delay

      yield* svc.updateConfig(updates)

      const cfg = yield* svc.getConfig()
      UI.println(
        `auto-reply ${cfg.enabled ? UI.Style.TEXT_SUCCESS_BOLD + "enabled" : UI.Style.TEXT_DIM + "disabled"}${UI.Style.TEXT_NORMAL}`,
      )
    }).pipe(Effect.provide(AutoReply.layer)),
})
