import { Auth } from "../../../auth"
import { AuthBrowser } from "@/auth/browser"
import { effectCmd, fail } from "../../effect-cmd"
import { UI } from "../../ui"
import * as Prompt from "../../effect/prompt"
import { Effect, Option } from "effect"
import { cliTry } from "./plugin-auth"
import type { Argv } from "yargs"

const promptValue = <Value>(value: Option.Option<Value>) => {
  if (Option.isNone(value)) return Effect.die(new UI.CancelledError())
  return Effect.succeed(value.value)
}

function selectOAuthRecord(accounts: Auth.OAuthRecordMeta[], recordID: string | undefined, message: string) {
  if (recordID) return Effect.succeed(recordID)
  if (accounts.length === 0) return fail("No Anthropic OAuth accounts found")
  return Effect.flatMap(
    Prompt.select({
      message,
      options: accounts.map((a) => ({ label: a.label ?? a.id, value: a.id })),
    }),
    promptValue,
  )
}

export const AuthBrowserListCommand = effectCmd({
  command: "list",
  describe: "list OAuth browser sessions",
  instance: false,
  handler: Effect.fn("Cli.auth.browser.list")(function* () {
    UI.empty()
    yield* Prompt.intro("Browser sessions")
    const sessions = yield* cliTry("Failed to list browser sessions: ", () => AuthBrowser.listAll())
    const accounts = yield* cliTry("Failed to list OAuth accounts: ", () => Auth.OAuthPool.list("anthropic", "default"))
    if (sessions.length === 0) {
      yield* Prompt.log.info("No browser sessions configured")
      yield* Prompt.outro("Done")
      return
    }
    for (const session of sessions) {
      const account = accounts.find((a) => a.id === session.recordId)
      yield* Prompt.log.info(
        `${account?.label ?? session.recordId} ${UI.Style.TEXT_DIM}${session.isConfigured ? "configured" : "not configured"}`,
      )
    }
    yield* Prompt.outro(`${sessions.length} session` + (sessions.length === 1 ? "" : "s"))
  }),
})

export const AuthBrowserSetupCommand = effectCmd({
  command: "setup [recordId]",
  describe: "set up a browser session for an Anthropic OAuth account",
  instance: false,
  builder: (yargs) => yargs.positional("recordId", { describe: "OAuth record id", type: "string" }),
  handler: Effect.fn("Cli.auth.browser.setup")(function* (args) {
    const accounts = yield* cliTry("Failed to list OAuth accounts: ", () => Auth.OAuthPool.list("anthropic", "default"))
    const recordID = yield* selectOAuthRecord(accounts, args.recordId, "Select account")
    const tokens = yield* cliTry("Failed to set up browser session: ", () => AuthBrowser.setup(recordID))
    yield* cliTry("Failed to update OAuth account: ", () =>
      Auth.OAuthPool.updateRecord("anthropic", recordID, "default", tokens),
    )
    yield* Prompt.outro("Browser session configured")
  }),
})

export const AuthBrowserRefreshCommand = effectCmd({
  command: "refresh [recordId]",
  describe: "refresh tokens through an existing browser session",
  instance: false,
  builder: (yargs) => yargs.positional("recordId", { describe: "OAuth record id", type: "string" }),
  handler: Effect.fn("Cli.auth.browser.refresh")(function* (args) {
    const accounts = yield* cliTry("Failed to list OAuth accounts: ", () => Auth.OAuthPool.list("anthropic", "default"))
    const recordID = yield* selectOAuthRecord(accounts, args.recordId, "Select account")
    const tokens = yield* cliTry("Failed to refresh browser session: ", () => AuthBrowser.refresh(recordID))
    yield* cliTry("Failed to update OAuth account: ", () =>
      Auth.OAuthPool.updateRecord("anthropic", recordID, "default", tokens),
    )
    yield* Prompt.outro("Tokens refreshed")
  }),
})

export const AuthBrowserRemoveCommand = effectCmd({
  command: "remove [recordId]",
  describe: "remove a browser session profile",
  instance: false,
  builder: (yargs) => yargs.positional("recordId", { describe: "OAuth record id", type: "string" }),
  handler: Effect.fn("Cli.auth.browser.remove")(function* (args) {
    const accounts = yield* cliTry("Failed to list OAuth accounts: ", () => Auth.OAuthPool.list("anthropic", "default"))
    const recordID = yield* selectOAuthRecord(accounts, args.recordId, "Select account")
    yield* cliTry("Failed to remove browser session: ", () => AuthBrowser.remove(recordID))
    yield* Prompt.outro("Browser session removed")
  }),
})

export const AuthBrowserCommand = {
  command: "browser",
  describe: "manage OAuth browser sessions",
  builder: (yargs: Argv) =>
    yargs
      .command(AuthBrowserListCommand)
      .command(AuthBrowserSetupCommand)
      .command(AuthBrowserRefreshCommand)
      .command(AuthBrowserRemoveCommand)
      .demandCommand(),
  async handler() {},
}
