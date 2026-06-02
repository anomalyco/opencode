import { Effect, Schema } from "effect"
import * as Tool from "../../tool/tool"
import { engine } from "./engine"
import { ContextParameters } from "./schema"

export const ContextTool = Tool.define(
  "browser_context",
  Effect.gen(function* () {
    return {
      description:
        "Manage browser context: inspect frames, read/write cookies, and access localStorage",
      parameters: ContextParameters,
      execute: (params: Schema.Schema.Type<typeof ContextParameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "browser",
            patterns: [],
            always: ["*"],
            metadata: { action: params.action },
          })

          const page: any = yield* Effect.promise(() => engine.ensurePage(ctx.sessionID))

          switch (params.action) {
            case "listFrames": {
              const frames = page.frames().map((f: any) => ({
                name: f.name(),
                url: f.url(),
                isMain: f === page.mainFrame(),
              }))
              return {
                title: "Listed browser frames",
                output: JSON.stringify(frames, null, 2),
                metadata: {},
              }
            }

            case "switchFrame": {
              // Playwright does not have a "switch frame" concept at the API level.
              // All actions operate on the page; we return frame metadata for reference.
              const frames = page.frames()
              const target = params.target
              const frame = target
                ? frames.find(
                    (f: any) =>
                      f.name() === target || String(frames.indexOf(f)) === target,
                  )
                : page.mainFrame()

              if (!frame) {
                throw new Error(`Frame not found: ${params.target}`)
              }

              return {
                title: `Frame info for ${frame.name() || "(main)"}`,
                output: JSON.stringify(
                  {
                    name: frame.name(),
                    url: frame.url(),
                    isMain: frame === page.mainFrame(),
                    note: "Playwright operates at the page level; this is reference info only.",
                  },
                  null,
                  2,
                ),
                metadata: {},
              }
            }

            case "getCookies": {
              const cookies = (yield* Effect.promise(() =>
                page.context().cookies(params.target ? [params.target] : undefined),
              )) as Array<{ name: string; value: string; domain: string; path: string }>
              const filtered = params.domain
                ? cookies.filter((c) => c.domain.includes(params.domain!))
                : cookies
              return {
                title: "Retrieved cookies",
                output: JSON.stringify(filtered, null, 2),
                metadata: {},
              }
            }

            case "setCookies": {
              if (!params.name || !params.value) {
                throw new Error("setCookies requires both 'name' and 'value'")
              }
              const hostname = new URL(page.url()).hostname
              yield* Effect.promise(() =>
                page.context().addCookies([
                  {
                    name: params.name!,
                    value: params.value!,
                    domain: params.domain ?? hostname,
                    path: "/",
                  },
                ]),
              )
              return {
                title: `Set cookie: ${params.name}`,
                output: `Cookie "${params.name}" set for domain ${params.domain ?? hostname}`,
                metadata: {},
              }
            }

            case "clearCookies": {
              if (params.name) {
                // Clear only the named cookie: get all, filter out matching, set remaining
                const all = (yield* Effect.promise(() =>
                  page.context().cookies(),
                )) as Array<{ name: string; value: string; domain: string; path: string }>
                const remaining = all.filter((c) => c.name !== params.name)
                yield* Effect.promise(() => page.context().clearCookies())
                yield* Effect.promise(() =>
                  remaining.length > 0
                    ? page.context().addCookies(remaining)
                    : Promise.resolve(),
                )
                return {
                  title: `Cleared cookie: ${params.name}`,
                  output: `Cookie "${params.name}" removed`,
                  metadata: {},
                }
              }

              yield* Effect.promise(() => page.context().clearCookies())
              return {
                title: "Cleared all cookies",
                output: "All cookies cleared",
                metadata: {},
              }
            }

            case "getLocalStorage": {
              if (!params.target) {
                throw new Error("getLocalStorage requires 'target' (the key to read)")
              }
              const value = (yield* Effect.tryPromise({
                try: (): Promise<string | null> =>
                  page.evaluate((key: string) => localStorage.getItem(key), params.target),
                catch: () => null as string | null,
              })) as string | null
              return {
                title: `Read localStorage key: ${params.target}`,
                output: JSON.stringify({ key: params.target, value }),
                metadata: {},
              }
            }

            case "setLocalStorage": {
              if (!params.target || !params.value) {
                throw new Error("setLocalStorage requires both 'target' (key) and 'value'")
              }
              yield* Effect.promise(() =>
                page.evaluate(
                  ({ key, value }: { key: string; value: string }) =>
                    localStorage.setItem(key, value),
                  { key: params.target, value: params.value },
                ),
              )
              return {
                title: `Set localStorage key: ${params.target}`,
                output: `localStorage["${params.target}"] set`,
                metadata: {},
              }
            }

            case "removeLocalStorage": {
              if (!params.target) {
                throw new Error("removeLocalStorage requires 'target' (the key to remove)")
              }
              yield* Effect.promise(() =>
                page.evaluate((key: string) => localStorage.removeItem(key), params.target),
              )
              return {
                title: `Removed localStorage key: ${params.target}`,
                output: `localStorage["${params.target}"] removed`,
                metadata: {},
              }
            }
          }
        }).pipe(Effect.orDie),
    }
  }),
)
