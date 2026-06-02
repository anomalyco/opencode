import { Effect, Schema } from "effect"
import * as Tool from "../../tool/tool"
import { engine } from "./engine"
import { ActionParameters } from "./schema"

export const ActionTool = Tool.define(
  "browser_action",
  Effect.gen(function* () {
    return {
      description:
        "Perform an interaction action on the current page (click, type, select, scroll, etc.)",
      parameters: ActionParameters,
      execute: (params: Schema.Schema.Type<typeof ActionParameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "browser",
            patterns: [params.target],
            always: ["*"],
            metadata: { target: params.target, action: params.action },
          })

          const page: any = yield* Effect.promise(() => engine.ensurePage(ctx.sessionID))

          switch (params.action) {
            case "click": {
              yield* Effect.promise(() => page.click(params.target))
              return {
                title: `Clicked ${params.target}`,
                output: `Clicked ${params.target}`,
                metadata: {},
              }
            }

            case "doubleClick": {
              yield* Effect.promise(() => page.dblclick(params.target))
              return {
                title: `Double-clicked ${params.target}`,
                output: `Double-clicked ${params.target}`,
                metadata: {},
              }
            }

            case "rightClick": {
              yield* Effect.promise(() => page.click(params.target, { button: "right" }))
              return {
                title: `Right-clicked ${params.target}`,
                output: `Right-clicked ${params.target}`,
                metadata: {},
              }
            }

            case "type": {
              if (!params.value) {
                return yield* Effect.fail(
                  new Error("type action requires a 'value' parameter containing the text to type"),
                )
              }
              yield* Effect.promise(() => page.fill(params.target, params.value))
              return {
                title: `Typed into ${params.target}`,
                output: `Typed "${params.value}" into ${params.target}`,
                metadata: {},
              }
            }

            case "clear": {
              yield* Effect.promise(() => page.fill(params.target, ""))
              return {
                title: `Cleared ${params.target}`,
                output: `Cleared ${params.target}`,
                metadata: {},
              }
            }

            case "hover": {
              yield* Effect.promise(() => page.hover(params.target))
              return {
                title: `Hovered ${params.target}`,
                output: `Hovered ${params.target}`,
                metadata: {},
              }
            }

            case "focus": {
              yield* Effect.promise(() => page.focus(params.target))
              return {
                title: `Focused ${params.target}`,
                output: `Focused ${params.target}`,
                metadata: {},
              }
            }

            case "select": {
              const optionValue = params.optionValue ?? params.value
              if (!optionValue) {
                return yield* Effect.fail(
                  new Error("select action requires a 'value' or 'optionValue' parameter"),
                )
              }
              yield* Effect.promise(() => page.selectOption(params.target, optionValue))
              return {
                title: `Selected option in ${params.target}`,
                output: `Selected "${optionValue}" in ${params.target}`,
                metadata: {},
              }
            }

            case "check": {
              yield* Effect.promise(() => page.check(params.target))
              return {
                title: `Checked ${params.target}`,
                output: `Checked ${params.target}`,
                metadata: {},
              }
            }

            case "uncheck": {
              yield* Effect.promise(() => page.uncheck(params.target))
              return {
                title: `Unchecked ${params.target}`,
                output: `Unchecked ${params.target}`,
                metadata: {},
              }
            }

            case "upload": {
              if (!params.value) {
                return yield* Effect.fail(
                  new Error("upload action requires a 'value' parameter with file path(s)"),
                )
              }
              yield* Effect.promise(() => page.setInputFiles(params.target, params.value))
              return {
                title: `Uploaded file(s) to ${params.target}`,
                output: `Uploaded "${params.value}" to ${params.target}`,
                metadata: {},
              }
            }

            case "scroll": {
              const pixels = params.pixels ?? 100
              yield* Effect.promise(() => page.mouse.wheel(0, pixels))
              return {
                title: `Scrolled ${pixels}px`,
                output: `Scrolled ${pixels}px`,
                metadata: {},
              }
            }

            case "scrollToElement": {
              yield* Effect.promise(() =>
                page.locator(params.target).scrollIntoViewIfNeeded(),
              )
              return {
                title: `Scrolled to ${params.target}`,
                output: `Scrolled to ${params.target}`,
                metadata: {},
              }
            }
          }
        }).pipe(Effect.orDie),
    }
  }),
)
