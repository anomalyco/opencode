import { Effect } from "effect"
import { effectCmd } from "../effect-cmd"
import { DecisionVerbs } from "@/decision/verbs"
import { UI } from "../ui"

export const StatusCommand = effectCmd({
  command: "status",
  describe: "list decision receipts and open proposals",
  instance: false,
  builder: (yargs) =>
    yargs
      .option("id", {
        type: "string",
        describe: "filter by receipt id",
      })
      .option("proposal-id", {
        type: "string",
        describe: "filter by proposal id",
      })
      .option("limit", {
        type: "number",
        default: 20,
        describe: "max receipts to show",
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
  handler: Effect.fn("Cli.status")(function* (args) {
    const result = yield* Effect.promise(() =>
      DecisionVerbs.status({
        id: args.id,
        proposal_id: args.proposalId,
        limit: args.limit,
        cwd: args.cwd,
      }),
    )
    if (args.json) {
      console.log(JSON.stringify(result, null, 2))
      return
    }
    UI.println(`${UI.Style.TEXT_NORMAL_BOLD}open proposals${UI.Style.TEXT_NORMAL} (${result.open.length})`)
    for (const r of result.open) {
      UI.println(`  ${r.id}  ${r.action}${r.adverse ? " [adverse]" : ""}  dry_run=${r.dry_run}`)
    }
    UI.println(`${UI.Style.TEXT_NORMAL_BOLD}receipts${UI.Style.TEXT_NORMAL} (${result.receipts.length})`)
    for (const r of result.receipts) {
      UI.println(
        `  ${r.ts}  ${r.verb}/${r.state}  ${r.id}  ${r.action}${r.proposal_id ? `  proposal=${r.proposal_id}` : ""}`,
      )
    }
    UI.println(`${UI.Style.TEXT_DIM}${result.path}${UI.Style.TEXT_NORMAL}`)
  }),
})
