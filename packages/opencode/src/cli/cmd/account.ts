import { cmd } from "./cmd"
import { Duration, Effect, Match, Option } from "effect"
import { UI } from "../ui"
import { Account } from "@/account/account"
import { AccountID, OrgID, PollExpired, type PollResult, type AccountError } from "@/account/schema"
import { AppRuntime } from "@/effect/app-runtime"
import * as Prompt from "../effect/prompt"
import open from "open"

const openBrowser = (url: string) => Effect.promise(() => open(url).catch(() => undefined))

const println = (msg: string) => Effect.sync(() => UI.println(msg))

const dim = (value: string) => UI.Style.TEXT_DIM + value + UI.Style.TEXT_NORMAL

const activeSuffix = (isActive: boolean) => (isActive ? dim(" (active)") : "")

export const formatAccountLabel = (account: { email: string; url: string }, isActive: boolean) =>
  `${account.email} ${dim(account.url)}${activeSuffix(isActive)}`

const formatOrgChoiceLabel = (account: { email: string }, org: { name: string }, isActive: boolean) =>
  `${org.name} (${account.email})${activeSuffix(isActive)}`

export const formatOrgLine = (
  account: { email: string; url: string },
  org: { id: string; name: string },
  isActive: boolean,
) => {
  const dot = isActive ? UI.Style.TEXT_SUCCESS + "●" + UI.Style.TEXT_NORMAL : " "
  const name = isActive ? UI.Style.TEXT_HIGHLIGHT_BOLD + org.name + UI.Style.TEXT_NORMAL : org.name
  return `  ${dot} ${name}  ${dim(account.email)}  ${dim(account.url)}  ${dim(org.id)}`
}

const isActiveOrgChoice = (
  active: Option.Option<{ id: AccountID; active_org_id: OrgID | null }>,
  choice: { accountID: AccountID; orgID: OrgID },
) => Option.isSome(active) && active.value.id === choice.accountID && active.value.active_org_id === choice.orgID

const loginEffect = Effect.fn("login")(function* (url: string) {
  const service = yield* Account.Service

  yield* Prompt.intro("Log in")
  const login = yield* service.login(url)

  yield* Prompt.log.info("Go to: " + login.url)
  yield* Prompt.log.info("Enter code: " + login.user)
  yield* openBrowser(login.url)

  const s = Prompt.spinner()
  yield* s.start("Waiting for authorization...")

  const poll = (wait: Duration.Duration): Effect.Effect<PollResult, AccountError> =>
    Effect.gen(function* () {
      yield* Effect.sleep(wait)
      const result = yield* service.poll(login)
      if (result._tag === "PollPending") return yield* poll(wait)
      if (result._tag === "PollSlow") return yield* poll(Duration.sum(wait, Duration.seconds(5)))
      return result
    })

  const result = yield* poll(login.interval).pipe(
    Effect.timeout(login.expiry),
    Effect.catchTag("TimeoutError", () => Effect.succeed(new PollExpired())),
  )

  yield* Match.valueTags(result, {
    PollSuccess: (r) =>
      Effect.gen(function* () {
        yield* s.stop("Logged in as " + r.email)
        yield* Prompt.outro("Done")
      }),
    PollExpired: () => s.stop("Device code expired", 1),
    PollDenied: () => s.stop("Authorization denied", 1),
    PollError: (r) => s.stop("Error: " + String(r.cause), 1),
    PollPending: () => s.stop("Unexpected state", 1),
    PollSlow: () => s.stop("Unexpected state", 1),
  })
})

const logoutEffect = Effect.fn("logout")(function* (email?: string) {
  const service = yield* Account.Service
  const accounts = yield* service.list()
  if (accounts.length === 0) return yield* println("Not logged in")

  if (email) {
    const match = accounts.find((a) => a.email === email)
    if (!match) return yield* println("Account not found: " + email)
    yield* service.remove(match.id)
    yield* Prompt.outro("Logged out from " + email)
    return
  }

  const active = yield* service.active()
  const activeID = Option.map(active, (a) => a.id)

  yield* Prompt.intro("Log out")

  const opts = accounts.map((a) => {
    const isActive = Option.isSome(activeID) && activeID.value === a.id
    return {
      value: a,
      label: formatAccountLabel(a, isActive),
    }
  })

  const selected = yield* Prompt.select({ message: "Select account to log out", options: opts })
  if (Option.isNone(selected)) return

  yield* service.remove(selected.value.id)
  yield* Prompt.outro("Logged out from " + selected.value.email)
})

interface OrgChoice {
  orgID: OrgID
  accountID: AccountID
  label: string
}

const switchEffect = Effect.fn("switch")(function* () {
  const service = yield* Account.Service

  const groups = yield* service.orgsByAccount()
  if (groups.length === 0) return yield* println("Not logged in")

  const active = yield* service.active()

  const opts = groups.flatMap((group) =>
    group.orgs.map((org) => {
      const isActive = isActiveOrgChoice(active, { accountID: group.account.id, orgID: org.id })
      return {
        value: { orgID: org.id, accountID: group.account.id, label: org.name },
        label: formatOrgChoiceLabel(group.account, org, isActive),
      }
    }),
  )
  if (opts.length === 0) return yield* println("No orgs found")

  yield* Prompt.intro("Switch org")

  const selected = yield* Prompt.select<OrgChoice>({ message: "Select org", options: opts })
  if (Option.isNone(selected)) return

  const choice = selected.value
  yield* service.use(choice.accountID, Option.some(choice.orgID))
  yield* Prompt.outro("Switched to " + choice.label)
})

const orgsEffect = Effect.fn("orgs")(function* () {
  const service = yield* Account.Service

  const groups = yield* service.orgsByAccount()
  if (groups.length === 0) return yield* println("No accounts found")
  if (!groups.some((group) => group.orgs.length > 0)) return yield* println("No orgs found")

  const active = yield* service.active()

  for (const group of groups) {
    for (const org of group.orgs) {
      const isActive = isActiveOrgChoice(active, { accountID: group.account.id, orgID: org.id })
      yield* println(formatOrgLine(group.account, org, isActive))
    }
  }
})

const openEffect = Effect.fn("open")(function* () {
  const service = yield* Account.Service
  const active = yield* service.active()
  if (Option.isNone(active)) return yield* println("No active account")

  const url = active.value.url
  yield* openBrowser(url)
  yield* Prompt.outro("Opened " + url)
})

export const LoginCommand = cmd({
  command: "login <url>",
  describe: false,
  builder: (yargs) =>
    yargs.positional("url", {
      describe: "server URL",
      type: "string",
      demandOption: true,
    }),
  async handler(args) {
    UI.empty()
    await AppRuntime.runPromise(loginEffect(args.url))
  },
})

export const LogoutCommand = cmd({
  command: "logout [email]",
  describe: false,
  builder: (yargs) =>
    yargs.positional("email", {
      describe: "account email to log out from",
      type: "string",
    }),
  async handler(args) {
    UI.empty()
    await AppRuntime.runPromise(logoutEffect(args.email))
  },
})

export const SwitchCommand = cmd({
  command: "switch",
  describe: false,
  async handler() {
    UI.empty()
    await AppRuntime.runPromise(switchEffect())
  },
})

export const OrgsCommand = cmd({
  command: "orgs",
  describe: false,
  async handler() {
    UI.empty()
    await AppRuntime.runPromise(orgsEffect())
  },
})

export const OpenCommand = cmd({
  command: "open",
  describe: false,
  async handler() {
    UI.empty()
    await AppRuntime.runPromise(openEffect())
  },
})

export const ConsoleCommand = cmd({
  command: "console",
  describe: false,
  builder: (yargs) =>
    yargs
      .command({
        ...LoginCommand,
        describe: "log in to console",
      })
      .command({
        ...LogoutCommand,
        describe: "log out from console",
      })
      .command({
        ...SwitchCommand,
        describe: "switch active org",
      })
      .command({
        ...OrgsCommand,
        describe: "list orgs",
      })
      .command({
        ...OpenCommand,
        describe: "open active console account",
      })
      .demandCommand(),
  async handler() {},
})
