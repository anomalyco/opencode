import { cmd } from "../cmd"

const McpListCommand = cmd({
  command: "list",
  aliases: ["ls"],
  describe: "list MCP servers and their status",
  handler: async () => {
    await import("./handler").then(({ listHandler }) => listHandler())
  },
})

const McpAuthListCommand = cmd({
  command: "list",
  aliases: ["ls"],
  describe: "list OAuth-capable MCP servers and their auth status",
  handler: async () => {
    await import("./handler").then(({ authListHandler }) => authListHandler())
  },
})

const McpAuthCommand = cmd({
  command: "auth [name]",
  describe: "authenticate with an OAuth-enabled MCP server",
  builder: (yargs) =>
    yargs
      .positional("name", {
        describe: "name of the MCP server",
        type: "string",
      })
      .command(McpAuthListCommand),
  handler: async (args) => {
    await import("./handler").then(({ authHandler }) => authHandler(args))
  },
})

const McpLogoutCommand = cmd({
  command: "logout [name]",
  describe: "remove OAuth credentials for an MCP server",
  builder: (yargs) =>
    yargs.positional("name", {
      describe: "name of the MCP server",
      type: "string",
    }),
  handler: async (args) => {
    await import("./handler").then(({ logoutHandler }) => logoutHandler(args))
  },
})

const McpAddCommand = cmd({
  command: "add",
  describe: "add an MCP server",
  handler: async () => {
    await import("./handler").then(({ addHandler }) => addHandler())
  },
})

const McpDebugCommand = cmd({
  command: "debug <name>",
  describe: "debug OAuth connection for an MCP server",
  builder: (yargs) =>
    yargs.positional("name", {
      describe: "name of the MCP server",
      type: "string",
      demandOption: true,
    }),
  handler: async (args) => {
    await import("./handler").then(({ debugHandler }) => debugHandler(args))
  },
})

export const McpCommand = cmd({
  command: "mcp",
  describe: "manage MCP (Model Context Protocol) servers",
  builder: (yargs) =>
    yargs
      .command(McpAddCommand)
      .command(McpListCommand)
      .command(McpAuthCommand)
      .command(McpLogoutCommand)
      .command(McpDebugCommand)
      .demandCommand(),
  handler: async () => {},
})
