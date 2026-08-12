import { Effect } from "effect"
import { effectCmd } from "../effect-cmd"
import { DecisionActivity } from "@/decision/activity"
import { UI } from "../ui"

export const ActivityCommand = effectCmd({
  command: "activity",
  describe: "summarize recent hiring decision activity (local receipts)",
  instance: false,
  builder: (yargs) =>
    yargs
      .option("days", {
        type: "number",
        default: 7,
        describe: "lookback window in days",
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
  handler: Effect.fn("Cli.activity")(function* (args) {
    const summary = yield* Effect.promise(() =>
      DecisionActivity.summarizeActivity({
        days: args.days,
        cwd: args.cwd,
      }),
    )
    if (args.json) {
      console.log(
        JSON.stringify(
          {
            days: summary.days,
            path: summary.path,
            commits: summary.commits,
            pushes: summary.pushes,
            needs_confirm: summary.needs_confirm,
            active_days: summary.active_days,
            open_commits: summary.open_commits,
            signal: summary.signal,
            real_req_note: summary.real_req_note,
          },
          null,
          2,
        ),
      )
      return
    }
    if (summary.signal === "quiet") {
      UI.println(
        `${UI.Style.TEXT_DIM}Last ${summary.days} days (receipts): no decision activity${UI.Style.TEXT_NORMAL}`,
      )
      UI.println(`${UI.Style.TEXT_NORMAL_BOLD}Signal: quiet${UI.Style.TEXT_NORMAL} — no eng-TA commit in window`)
      UI.println(`${UI.Style.TEXT_DIM}Path: ${summary.path}${UI.Style.TEXT_NORMAL}`)
      return
    }
    UI.println(
      `Last ${summary.days} days (receipts): ${summary.commits} commits, ${summary.pushes} push`,
    )
    UI.println(`Active days: ${summary.active_days}`)
    UI.println(
      `${UI.Style.TEXT_SUCCESS_BOLD}Signal: active${UI.Style.TEXT_NORMAL} — eng-TA decision activity detected`,
    )
    UI.println(`${UI.Style.TEXT_DIM}Path: ${summary.path}${UI.Style.TEXT_NORMAL}`)
  }),
})
