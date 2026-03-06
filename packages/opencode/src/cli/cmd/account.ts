import { cmd } from "./cmd"
import * as prompts from "@clack/prompts"
import { UI } from "../ui"
import { Account } from "@/account"

export const LoginCommand = cmd({
  command: "login [url]",
  describe: "log in to an opencode account",
  builder: (yargs) =>
    yargs.positional("url", {
      describe: "server URL",
      type: "string",
    }),
  async handler(args) {
    UI.empty()
    prompts.intro("Log in")

    const url = args.url as string | undefined
    const login = await Account.login(url)

    prompts.log.info("Go to: " + login.url)
    prompts.log.info("Enter code: " + login.user)

    try {
      const open =
        process.platform === "darwin"
          ? ["open", login.url]
          : process.platform === "win32"
            ? ["cmd", "/c", "start", login.url]
            : ["xdg-open", login.url]
      Bun.spawn(open, { stdout: "ignore", stderr: "ignore" })
    } catch {}

    const spinner = prompts.spinner()
    spinner.start("Waiting for authorization...")

    let wait = login.interval * 1000
    while (true) {
      await Bun.sleep(wait)

      const result = await Account.poll(login)

      if (result.type === "success") {
        spinner.stop("Logged in as " + result.email)
        prompts.outro("Done")
        return
      }

      if (result.type === "pending") continue

      if (result.type === "slow") {
        wait += 5000
        continue
      }

      if (result.type === "expired") {
        spinner.stop("Device code expired", 1)
        return
      }

      if (result.type === "denied") {
        spinner.stop("Authorization denied", 1)
        return
      }

      spinner.stop("Error: " + result.msg, 1)
      return
    }
  },
})

export const LogoutCommand = cmd({
  command: "logout [email]",
  describe: "log out from an account",
  builder: (yargs) =>
    yargs.positional("email", {
      describe: "account email to log out from",
      type: "string",
    }),
  async handler(args) {
    const email = args.email as string | undefined

    if (email) {
      const accounts = Account.list()
      const match = accounts.find((a) => a.email === email)
      if (!match) {
        UI.println("Account not found: " + email)
        return
      }
      Account.remove(match.id)
      UI.println("Logged out from " + email)
      return
    }

    const active = Account.active()
    if (!active) {
      UI.println("Not logged in")
      return
    }
    Account.remove(active.id)
    UI.println("Logged out from " + active.email)
  },
})

export const SwitchCommand = cmd({
  command: "switch",
  describe: "switch active org",
  async handler() {
    UI.empty()

    const active = Account.active()
    if (!active) {
      UI.println("Not logged in")
      return
    }

    const orgs = await Account.orgs(active.id)
    if (orgs.length === 0) {
      UI.println("No orgs found")
      return
    }

    prompts.intro("Switch org")

    const opts = orgs.map((o) => ({
      value: o.id,
      label: o.id === active.org_id ? o.name + UI.Style.TEXT_DIM + " (active)" : o.name,
    }))

    const selected = await prompts.select({
      message: "Select org",
      options: opts,
    })

    if (prompts.isCancel(selected)) return

    Account.use(active.id, selected as string)
    prompts.outro("Switched to " + orgs.find((o) => o.id === selected)?.name)
  },
})

export const OrgsCommand = cmd({
  command: "orgs",
  aliases: ["org"],
  describe: "list all orgs",
  async handler() {
    const accounts = Account.list()

    if (accounts.length === 0) {
      UI.println("No accounts found")
      return
    }

    for (const account of accounts) {
      const orgs = await Account.orgs(account.id)
      for (const org of orgs) {
        UI.println([org.name, account.email, org.id].join("\t"))
      }
    }
  },
})
