import z from "zod"
import { Identifier } from "../id/id"
import { Log } from "../util/log"
import { SessionPrompt } from "./prompt"
import { MessageV2 } from "./message-v2"
import { Instance } from "../project/instance"
import { fn } from "@/util/fn"

export namespace SessionRunner {
  const log = Log.create({ service: "session.runner" })

  export const Options = z
    .object({
      model: z.object({
        providerID: z.string(),
        modelID: z.string(),
      }),
      agent: z.string(),
      tools: z.record(z.string(), z.boolean()).optional(),
      origin: z
        .object({
          parentSessionID: Identifier.schema("session").optional(),
          parentMessageID: Identifier.schema("message").optional(),
          description: z.string().optional(),
          command: z.string().optional(),
        })
        .optional(),
      timeoutMs: z.number().optional(),
      maxSteps: z.number().optional(),
    })
    .meta({ ref: "SessionRunnerOptions" })
  export type Options = z.infer<typeof Options>

  export const RunResult = z
    .object({
      sessionID: Identifier.schema("session"),
      message: MessageV2.WithParts,
      success: z.boolean(),
      error: z.string().optional(),
    })
    .meta({ ref: "SessionRunnerResult" })
  export type RunResult = z.infer<typeof RunResult>

  const state = Instance.state(() => ({
    active: {} as Record<
      string,
      {
        startedAt: number
        options: Options
        promise: Promise<RunResult>
      }
    >,
  }))

  export function isRunning(id: string): boolean {
    return id in state().active
  }

  export function listActive(): string[] {
    return Object.keys(state().active)
  }

  export const runOnce = fn(SessionPrompt.PromptInput, async (input): Promise<MessageV2.WithParts> => {
    log.info("runOnce", { sessionID: input.sessionID, agent: input.agent })
    return SessionPrompt.prompt(input)
  })

  export function runBackground(_id: string, _options: Options): void {
    throw new Error("SessionRunner.runBackground not yet implemented")
  }

  export function cancelBackground(_id: string): boolean {
    throw new Error("SessionRunner.cancelBackground not yet implemented")
  }

  export async function waitFor(_id: string): Promise<RunResult> {
    throw new Error("SessionRunner.waitFor not yet implemented")
  }
}
