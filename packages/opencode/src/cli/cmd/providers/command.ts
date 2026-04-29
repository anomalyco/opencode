import { cmd } from "../cmd"

const ProvidersListCommand = cmd({
  command: "list",
  aliases: ["ls"],
  describe: "list providers and credentials",
  async handler(_args) {
    await import("./handler").then(({ listHandler }) => listHandler())
  },
})

const ProvidersLoginCommand = cmd({
  command: "login [url]",
  describe: "log in to a provider",
  builder: (yargs) =>
    yargs
      .positional("url", {
        describe: "opencode auth provider",
        type: "string",
      })
      .option("provider", {
        alias: ["p"],
        describe: "provider id or name to log in to (skips provider selection)",
        type: "string",
      })
      .option("method", {
        alias: ["m"],
        describe: "login method label (skips method selection)",
        type: "string",
      }),
  async handler(args) {
    await import("./handler").then(({ loginHandler }) => loginHandler(args))
  },
})

const ProvidersLogoutCommand = cmd({
  command: "logout",
  describe: "log out from a configured provider",
  async handler(_args) {
    await import("./handler").then(({ logoutHandler }) => logoutHandler())
  },
})

export const ProvidersCommand = cmd({
  command: "providers",
  aliases: ["auth"],
  describe: "manage AI providers and credentials",
  builder: (yargs) =>
    yargs.command(ProvidersListCommand).command(ProvidersLoginCommand).command(ProvidersLogoutCommand).demandCommand(),
  async handler() {},
})
