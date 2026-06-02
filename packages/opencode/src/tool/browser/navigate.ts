import { Effect, Schema } from "effect"
import * as Tool from "../../tool/tool"
import { engine } from "./engine"
import { NavigateParameters } from "./schema"

type Params = Schema.Schema.Type<typeof NavigateParameters>

export const NavigateTool = Tool.define(
  "browser_navigate",
  Effect.gen(function* () {
    return {
      description:
        "Navigate the browser: go to a URL, go back/forward, refresh, open/close/switch tabs, or list tabs",
      parameters: NavigateParameters,
      execute: (params: Params, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const patterns =
            params.action === "goto"
              ? [params.url ?? ""]
              : params.target
                ? [params.target]
                : []

          yield* ctx.ask({
            permission: "browser",
            patterns,
            always: ["*"],
            metadata: { action: params.action, url: params.url, target: params.target },
          })

          // -- goto --
          if (params.action === "goto") {
            if (!params.url) {
              return yield* Effect.fail(new Error("goto action requires a 'url' parameter"))
            }
            const page: any = yield* Effect.promise(() => engine.ensurePage(ctx.sessionID))
            yield* Effect.promise(() => page.goto(params.url, { waitUntil: "load" }))
            const title = (yield* Effect.promise(() => page.title())) as string
            return {
              title: `Navigated to ${params.url}`,
              output: `Title: ${title}\nURL: ${params.url}`,
              metadata: {},
            }
          }

          // -- back --
          if (params.action === "back") {
            const page: any = yield* Effect.promise(() => engine.ensurePage(ctx.sessionID))
            yield* Effect.promise(() => page.goBack())
            const url = page.url() as string
            return {
              title: "Navigated back",
              output: `URL: ${url}`,
              metadata: {},
            }
          }

          // -- forward --
          if (params.action === "forward") {
            const page: any = yield* Effect.promise(() => engine.ensurePage(ctx.sessionID))
            yield* Effect.promise(() => page.goForward())
            const url = page.url() as string
            return {
              title: "Navigated forward",
              output: `URL: ${url}`,
              metadata: {},
            }
          }

          // -- refresh --
          if (params.action === "refresh") {
            const page: any = yield* Effect.promise(() => engine.ensurePage(ctx.sessionID))
            yield* Effect.promise(() => page.reload())
            const url = page.url() as string
            return {
              title: "Refreshed page",
              output: `URL: ${url}`,
              metadata: {},
            }
          }

          // -- newTab --
          if (params.action === "newTab") {
            const page: any = yield* Effect.promise(() =>
              engine.openTab(ctx.sessionID, params.target),
            )
            const url = page.url() as string
            const title = (yield* Effect.promise(() => page.title())) as string
            return {
              title: "Opened new tab",
              output: `New tab opened\nTitle: ${title}\nURL: ${url}`,
              metadata: {},
            }
          }

          // -- closeTab --
          if (params.action === "closeTab") {
            if (!params.target) {
              return yield* Effect.fail(new Error("closeTab action requires a 'target' parameter (tab ID)"))
            }
            yield* Effect.promise(() => engine.closeTab(ctx.sessionID, params.target!))
            const tabs = engine.listTabs(ctx.sessionID)
            const list = tabs.map((t) => `  ${t.active ? ">" : " "} ${t.pageId}: ${t.url}`).join("\n")
            return {
              title: "Closed tab",
              output: `Remaining tabs:\n${list || "  (none)"}`,
              metadata: {},
            }
          }

          // -- switchTab --
          if (params.action === "switchTab") {
            if (!params.target) {
              return yield* Effect.fail(new Error("switchTab action requires a 'target' parameter (tab ID)"))
            }
            const page: any = yield* Effect.promise(() =>
              engine.switchTab(ctx.sessionID, params.target!),
            )
            const url = page.url() as string
            const title = (yield* Effect.promise(() => page.title())) as string
            return {
              title: `Switched to tab ${params.target}`,
              output: `Active tab URL: ${url}\nTitle: ${title}`,
              metadata: {},
            }
          }

          // -- listTabs --
          if (params.action === "listTabs") {
            const tabs = engine.listTabs(ctx.sessionID)
            const lines = tabs.map(
              (t) => `${t.active ? ">" : " "} ${t.pageId}\n    URL: ${t.url}\n    Title: ${t.title || "(empty)"}`,
            )
            const output = lines.length > 0 ? lines.join("\n") : "No tabs open"
            return {
              title: "Listed tabs",
              output,
              metadata: {},
            }
          }

          // Unreachable — exhaustive union makes this dead code, but we must satisfy the type system
          return yield* Effect.fail(new Error(`Unknown action: ${(params as any).action}`))
        }).pipe(Effect.orDie),
    }
  }),
)
