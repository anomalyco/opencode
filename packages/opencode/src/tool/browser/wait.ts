import { Effect, Schema } from "effect"
import * as Tool from "../../tool/tool"
import { engine } from "./engine"
import { WaitParameters } from "./schema"

type Params = Schema.Schema.Type<typeof WaitParameters>

export const WaitTool = Tool.define(
  "browser_wait",
  Effect.gen(function* () {
    return {
      description:
        "Wait for a condition on the page: element appears, text is visible, or network becomes idle",
      parameters: WaitParameters,
      execute: (params: Params, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "browser",
            patterns: [params.target],
            always: ["*"],
            metadata: { action: params.action, target: params.target },
          })

          const page: any = yield* Effect.promise(() => engine.ensurePage(ctx.sessionID))
          const timeout = params.timeout ?? 30000

          switch (params.action) {
            case "waitForElement": {
              const result: Error | void = yield* Effect.tryPromise({
                try: (): Promise<void> => page.waitForSelector(params.target, { timeout }),
                catch: (error) => new Error(String(error)),
              }).pipe(Effect.catch((error) => Effect.succeed(error)))

              if (result instanceof Error) {
                return {
                  title: "Wait timed out",
                  output: `Timed out waiting for element "${params.target}" after ${timeout}ms`,
                  metadata: {},
                }
              }

              return {
                title: "Wait complete",
                output: `Element "${params.target}" appeared on page`,
                metadata: {},
              }
            }

            case "waitForText": {
              const result: Error | void = yield* Effect.tryPromise({
                try: (): Promise<void> =>
                  page.waitForFunction(
                    (text: string) => document.body.innerText.includes(text),
                    params.target,
                    { timeout },
                  ),
                catch: (error) => new Error(String(error)),
              }).pipe(Effect.catch((error) => Effect.succeed(error)))

              if (result instanceof Error) {
                return {
                  title: "Wait timed out",
                  output: `Timed out waiting for text "${params.target}" after ${timeout}ms`,
                  metadata: {},
                }
              }

              return {
                title: "Wait complete",
                output: `Text "${params.target}" found on page`,
                metadata: {},
              }
            }

            case "waitForNetworkIdle": {
              const result: Error | void = yield* Effect.tryPromise({
                try: (): Promise<void> => page.waitForLoadState("networkidle", { timeout }),
                catch: (error) => new Error(String(error)),
              }).pipe(Effect.catch((error) => Effect.succeed(error)))

              if (result instanceof Error) {
                return {
                  title: "Wait timed out",
                  output: `Timed out waiting for network idle after ${timeout}ms`,
                  metadata: {},
                }
              }

              return {
                title: "Wait complete",
                output: "Network is idle",
                metadata: {},
              }
            }
          }
        }).pipe(Effect.orDie),
    }
  }),
)
