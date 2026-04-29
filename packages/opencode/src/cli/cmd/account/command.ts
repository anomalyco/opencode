import { cmd } from "../cmd"

const LoginCommand = cmd({
  command: "login <url>",
  describe: false,
  builder: (yargs) =>
    yargs.positional("url", {
      describe: "server URL",
      type: "string",
      demandOption: true,
    }),
  handler: async (args) => {
    await import("./handler").then(({ loginHandler }) => loginHandler(args))
  },
})

const LogoutCommand = cmd({
  command: "logout [email]",
  describe: false,
  builder: (yargs) =>
    yargs.positional("email", {
      describe: "account email to log out from",
      type: "string",
    }),
  handler: async (args) => {
    await import("./handler").then(({ logoutHandler }) => logoutHandler(args))
  },
})

const SwitchCommand = cmd({
  command: "switch",
  describe: false,
  handler: async () => {
    await import("./handler").then(({ switchHandler }) => switchHandler())
  },
})

const OrgsCommand = cmd({
  command: "orgs",
  describe: false,
  handler: async () => {
    await import("./handler").then(({ orgsHandler }) => orgsHandler())
  },
})

const OpenCommand = cmd({
  command: "open",
  describe: false,
  handler: async () => {
    await import("./handler").then(({ openHandler }) => openHandler())
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
  handler: async () => {},
})
