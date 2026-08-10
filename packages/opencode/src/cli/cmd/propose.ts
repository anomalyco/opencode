import { Effect } from "effect"
import { effectCmd, fail } from "../effect-cmd"
import { DecisionVerbs } from "@/decision/verbs"
import { UI } from "../ui"

export const ProposeCommand = effectCmd({
  command: "propose",
  describe: "record a decision proposal (dry-run by default)",
  instance: false,
  builder: (yargs) =>
    yargs
      .option("action", {
        type: "string",
        demandOption: true,
        describe: "action name (e.g. reject, offer, hire, note)",
      })
      .option("target-kind", {
        type: "string",
        describe: "opaque target kind",
      })
      .option("target-id", {
        type: "string",
        describe: "opaque target id",
      })
      .option("reason", {
        type: "string",
        describe: "human reason",
      })
      .option("meta", {
        type: "string",
        describe: "JSON object metadata (secrets scrubbed)",
      })
      .option("execute", {
        type: "boolean",
        default: false,
        describe: "set dry_run false (default is dry-run)",
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "print JSON only",
      })
      .option("cwd", {
        type: "string",
        describe: "working directory override",
      }),
  handler: Effect.fn("Cli.propose")(function* (args) {
    let meta: unknown
    if (args.meta) {
      try {
        meta = JSON.parse(args.meta)
      } catch {
        return yield* fail("invalid --meta JSON")
      }
    }
    const target =
      args.targetKind || args.targetId
        ? { kind: args.targetKind ?? "unknown", id: args.targetId }
        : undefined
    const result = yield* Effect.promise(() =>
      DecisionVerbs.propose({
        action: args.action,
        target,
        reason: args.reason,
        meta,
        dry_run: !args.execute,
        source: "cli",
        cwd: args.cwd,
      }),
    )
    if (args.json) {
      console.log(JSON.stringify(result, null, 2))
      return
    }
    UI.println(
      `${UI.Style.TEXT_SUCCESS_BOLD}proposed${UI.Style.TEXT_NORMAL} ${result.receipt.id} action=${result.receipt.action} dry_run=${result.receipt.dry_run}`,
    )
    if (result.receipt.adverse) UI.println(`${UI.Style.TEXT_WARNING}adverse action — apply will require --confirm${UI.Style.TEXT_NORMAL}`)
    UI.println(`${UI.Style.TEXT_DIM}${result.path}${UI.Style.TEXT_NORMAL}`)
  }),
})
