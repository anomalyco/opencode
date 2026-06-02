import { Effect, Schema } from "effect"
import * as Tool from "../../tool/tool"
import { engine } from "./engine"
import { EvalParameters } from "./schema"

type Params = Schema.Schema.Type<typeof EvalParameters>

export const EvalTool = Tool.define(
  "browser_eval",
  Effect.gen(function* () {
    return {
      description:
        "Execute arbitrary JavaScript in the browser page context and return the result. " +
        "Use this for computations, DOM queries, or any in-page logic. " +
        "The code runs in the page's own JavaScript context (like the browser console).",
      parameters: EvalParameters,
      execute: (params: Params, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "browser",
            patterns: [],
            always: ["*"],
            metadata: { action: "eval", code: params.code },
          })

          const page: any = yield* Effect.promise(() => engine.ensurePage(ctx.sessionID))
          const result: unknown = yield* Effect.promise(() => page.evaluate(params.code))

          // serialize based on returnByValue flag
          const output =
            params.returnByValue === false
              ? typeof result === "string"
                ? result
                : String(result)
              : typeof result === "string"
                ? result
                : JSON.stringify(result, null, 2)

          return {
            title: "JavaScript evaluation",
            output,
            metadata: {},
          }
        }).pipe(Effect.orDie),
    }
  }),
)
