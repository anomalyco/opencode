import { Effect, Schema } from "effect"
import * as Tool from "../../tool/tool"
import { engine } from "./engine"
import { DebugParameters } from "./schema"

export const DebugTool = Tool.define(
  "browser_debug",
  Effect.gen(function* () {
    return {
      description:
        "Browser debugging and diagnostics: inspect console logs, network requests, page errors, highlight elements, or locate elements by bounding box",
      parameters: DebugParameters,
      execute: (params: Schema.Schema.Type<typeof DebugParameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "browser",
            patterns: [],
            always: ["*"],
            metadata: { action: params.action, target: params.target, level: params.level },
          })

          const page: any = yield* Effect.promise(() => engine.ensurePage(ctx.sessionID))

          switch (params.action) {
            case "getConsoleLogs": {
              return {
                title: "Console logs",
                output: JSON.stringify({
                  message:
                    "Console log capture requires page-level event listeners (page.on('console', ...)). " +
                    "Set up capture during page creation or use browser_evaluate to attach a listener: " +
                    "page.on('console', msg => window.__consoleLogs = window.__consoleLogs || []; " +
                    "window.__consoleLogs.push({type: msg.type(), text: msg.text()}))",
                  suggestion:
                    "Use browser_evaluate to attach a console listener, then read window.__consoleLogs",
                }),
                metadata: {},
              }
            }

            case "getNetworkRequests": {
              return {
                title: "Network requests",
                output: JSON.stringify({
                  message:
                    "Network request capture requires page-level event listeners " +
                    "(page.on('request', ...) and page.on('response', ...)). " +
                    "Set up capture during page creation.",
                  suggestion:
                    "Use browser_evaluate to attach request/response listeners and store results " +
                    "on window.__networkRequests",
                }),
                metadata: {},
              }
            }

            case "getPageErrors": {
              return {
                title: "Page errors",
                output: JSON.stringify({
                  message:
                    "Page error capture requires a page-level listener (page.on('pageerror', ...)). " +
                    "Set up capture during page creation.",
                  suggestion:
                    "Use browser_evaluate to attach a pageerror listener: " +
                    "page.on('pageerror', err => window.__pageErrors = window.__pageErrors || []; " +
                    "window.__pageErrors.push(err.message))",
                }),
                metadata: {},
              }
            }

            case "highlightElement": {
              if (!params.target) {
                return {
                  title: "Highlight element — error",
                  output: JSON.stringify({ error: "target parameter is required for highlightElement" }),
                  metadata: {},
                }
              }
              const locator = page.locator(params.target)
              const count = yield* Effect.promise<number>(() => locator.count())
              if (count === 0) {
                return {
                  title: "Highlight element — not found",
                  output: JSON.stringify({ error: `No element found for selector: ${params.target}` }),
                  metadata: {},
                }
              }
              yield* Effect.promise<void>(() => locator.highlight())
              return {
                title: "Highlight element",
                output: JSON.stringify({ success: true, selector: params.target, highlighted: true }),
                metadata: {},
              }
            }

            case "locateElement": {
              if (!params.target) {
                return {
                  title: "Locate element — error",
                  output: JSON.stringify({ error: "target parameter is required for locateElement" }),
                  metadata: {},
                }
              }
              const locator = page.locator(params.target)
              const count = yield* Effect.promise<number>(() => locator.count())
              if (count === 0) {
                return {
                  title: "Locate element — not found",
                  output: JSON.stringify({ error: `No element found for selector: ${params.target}` }),
                  metadata: {},
                }
              }
              const box = yield* Effect.promise<{ x: number; y: number; width: number; height: number } | null>(
                () => locator.boundingBox(),
              )
              if (!box) {
                return {
                  title: "Locate element — not visible",
                  output: JSON.stringify({ error: `Element exists but has no bounding box (may be hidden): ${params.target}` }),
                  metadata: {},
                }
              }
              return {
                title: "Locate element",
                output: JSON.stringify({ selector: params.target, boundingBox: box }),
                metadata: {},
              }
            }
          }
        }).pipe(Effect.orDie),
    }
  }),
)
