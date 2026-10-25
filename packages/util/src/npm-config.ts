export * as NpmConfig from "./npm-config.js"

import { fileURLToPath } from "url"
import { Effect } from "effect"

export const load = (dir: string) =>
  Effect.tryPromise({
    try: async () => {
      // @ts-expect-error npm does not publish types for this internal config API.
      const { default: Config } = await import("@npmcli/config")
      // @ts-expect-error npm does not publish types for this internal config API.
      const { default: npmDefinitions } = await import("@npmcli/config/lib/definitions/index.js")
      const { definitions, flatten, nerfDarts, shorthands } = npmDefinitions
      const config = new Config({
        // Resolved per call: on workerd import.meta.url is undefined and building
        // this URL at module scope fails startup validation; npm config never runs there.
        npmPath: fileURLToPath(new URL("..", import.meta.url)),
        cwd: dir,
        env: { ...process.env },
        argv: [process.execPath, process.execPath, "--prefix", dir],
        execPath: process.execPath,
        platform: process.platform,
        definitions,
        flatten,
        nerfDarts,
        shorthands,
        warn: false,
      })
      await config.load()
      return config.flat as Record<string, unknown>
    },
    catch: (cause) => cause,
  }).pipe(Effect.orElseSucceed(() => ({}) as Record<string, unknown>))

export const registry = (dir: string) =>
  load(dir).pipe(
    Effect.map((config) => {
      const registry = typeof config.registry === "string" ? config.registry : "https://registry.npmjs.org"
      return registry.endsWith("/") ? registry.slice(0, -1) : registry
    }),
  )
