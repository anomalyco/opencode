import { CliApi } from "./cli-api"

export const Api = CliApi.make("opencode", {
  description: "OpenCode command line interface",
  commands: [
    CliApi.make("debug", {
      description: "Debugging and troubleshooting tools",
      commands: [CliApi.make("agents", { description: "List all agents" })],
    }),
    CliApi.make("migrate", { description: "Migrate v1 data to v2" }),
  ],
})
