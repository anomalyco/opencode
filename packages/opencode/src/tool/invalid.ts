import z from "zod"
import { Effect } from "effect"
import * as Tool from "./tool"

export const InvalidTool = Tool.define(
  "invalid",
  Effect.succeed({
    description: "Do not use",
    parameters: z.object({
      tool: z.string(),
      error: z.string(),
    }),
    execute: (params: { tool: string; error: string }) =>
      Effect.succeed({
        title: "Invalid Tool",
        output: `The arguments provided to the tool are invalid: ${params.error}`,
        metadata: {},
      }),
  }),
)
