import type { Argv } from "yargs"
import { cmd } from "../cmd.ts"

export const GenerateCommand = cmd({
  command: "generate",
  builder: (yargs: Argv) =>
    yargs.option("httpapi", {
      type: "boolean",
      default: false,
      description: "Generate OpenAPI from the experimental Effect HttpApi contract",
    }),
  handler: async (args) => {
    await import("./handler").then(({ handler }) => handler(args))
  },
})

export type GenerateArgs = Parameters<NonNullable<typeof GenerateCommand.handler>>[0]
