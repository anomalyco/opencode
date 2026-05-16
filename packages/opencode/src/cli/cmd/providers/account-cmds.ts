import { Auth } from "../../../auth"
import { effectCmd, fail } from "../../effect-cmd"
import { UI } from "../../ui"
import * as Prompt from "../../effect/prompt"
import { Effect, Option } from "effect"
import { cliTry } from "./plugin-auth"

const promptValue = <Value>(value: Option.Option<Value>) => {
  if (Option.isNone(value)) return Effect.die(new UI.CancelledError())
  return Effect.succeed(value.value)
}

function loadOAuthAccounts(auth: Record<string, Auth.Info>) {
  return Effect.gen(function* () {
    const nested = yield* Effect.forEach(Object.keys(auth), (providerID) =>
      auth[providerID]?.type === "oauth"
        ? cliTry("Failed to list OAuth accounts: ", () =>
            Auth.OAuthPool.list(providerID, "default").then((accounts) =>
              accounts.map((a) => ({ ...a, providerID, namespace: "default" })),
            ),
          )
        : Effect.succeed([]),
    )
    return nested.flat()
  })
}

function selectOAuthAccount(
  accounts: Array<Auth.OAuthRecordMeta & { providerID: string; namespace: string }>,
  recordID: string | undefined,
) {
  if (recordID) {
    const account = accounts.find((a) => a.id === recordID)
    if (!account) return fail("Account not found")
    return Effect.succeed(account)
  }
  if (accounts.length === 0) return fail("No OAuth accounts found")
  return Effect.map(
    Effect.flatMap(
      Prompt.select({
        message: "Select account",
        options: accounts.map((a) => ({
          label: `${a.label ?? a.id} ${UI.Style.TEXT_DIM}${a.providerID}`,
          value: a.id,
        })),
      }),
      promptValue,
    ),
    (selected) => accounts.find((a) => a.id === selected)!,
  )
}

export const AuthRenameCommand = effectCmd({
  command: "rename [recordId] [name]",
  describe: "rename an OAuth account",
  instance: false,
  builder: (yargs) =>
    yargs
      .positional("recordId", { describe: "OAuth record id", type: "string" })
      .positional("name", { describe: "New account name", type: "string" }),
  handler: Effect.fn("Cli.auth.rename")(function* (args) {
    const authSvc = yield* Auth.Service
    const accounts = yield* loadOAuthAccounts(yield* Effect.orDie(authSvc.all()))
    const selected = yield* selectOAuthAccount(accounts, args.recordId)
    const name =
      args.name ??
      (yield* promptValue(
        yield* Prompt.text({
          message: "Account name",
          placeholder: selected.label ?? selected.id,
          validate: (value) => (value && value.trim().length > 0 ? undefined : "Required"),
        }),
      ))
    const success = yield* cliTry("Failed to rename account: ", () =>
      Auth.OAuthPool.updateRecord(selected.providerID, selected.id, selected.namespace, { label: name.trim() }),
    )
    if (!success) return yield* fail("Account not found")
    yield* Prompt.outro("Account renamed")
  }),
})
