import { Effect } from "effect"
import { effectCmd, fail } from "../effect-cmd"
import { DecisionVerbs } from "@/decision/verbs"
import { UI } from "../ui"

export const PushCommand = effectCmd({
  command: "push",
  describe: "push a committed decision (records receipt only; dry-run by default)",
  instance: false,
  builder: (yargs) =>
    yargs
      .option("commit-id", {
        type: "string",
        demandOption: true,
        describe: "commit receipt id to push",
      })
      .option("execute", {
        type: "boolean",
        default: false,
        describe: "set dry_run false (default is dry-run)",
      })
      .option("confirm", {
        type: "boolean",
        default: false,
        describe: "acknowledge adverse action (reject/offer/hire)",
      })
      .option("meta", {
        type: "string",
        describe: "JSON object metadata (secrets scrubbed)",
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
  handler: Effect.fn("Cli.push")(function* (args) {
    let meta: unknown
    if (args.meta) {
      try {
        meta = JSON.parse(args.meta)
      } catch {
        return yield* fail("invalid --meta JSON")
      }
    }
    const result = yield* Effect.promise(() =>
      DecisionVerbs.push({
        commit_id: args.commitId,
        dry_run: !args.execute,
        confirm: args.confirm,
        source: "cli",
        cwd: args.cwd,
        meta,
      }),
    )
    if (!result.ok) {
      if (args.json) {
        console.log(
          JSON.stringify(
            {
              error: result.code,
              message: result.message,
              receipt: result.receipt,
              path: result.path,
            },
            null,
            2,
          ),
        )
      }
      return yield* fail(result.message, result.code === "needs_confirm" ? 2 : 1)
    }
    if (args.json) {
      console.log(JSON.stringify(result, null, 2))
      return
    }
    UI.println(
      `${UI.Style.TEXT_SUCCESS_BOLD}pushed${UI.Style.TEXT_NORMAL} ${result.receipt.id} action=${result.receipt.action} dry_run=${result.receipt.dry_run} commit=${result.receipt.commit_id}`,
    )
    UI.println(`${UI.Style.TEXT_DIM}${result.path}${UI.Style.TEXT_NORMAL}`)
  }),
})
