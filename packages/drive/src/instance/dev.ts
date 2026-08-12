import { mkdir, rm, symlink } from "node:fs/promises"
import { join, resolve } from "node:path"
import * as Effect from "effect/Effect"
import { instanceError } from "./error.js"

/**
 * Prepares an OpenCode development checkout for launch: verifies the CLI
 * entrypoint and reuses its installed `@opentui/solid` preload.
 */
export const prepareDev = Effect.fn("OpenCodeInstance.prepareDev")(function* (
  artifacts: string,
  directory: string,
) {
  const root = resolve(directory)
  const entrypoint = join(root, "packages", "cli", "src", "index.ts")
  const solid = join(root, "packages", "tui", "node_modules", "@opentui", "solid")
  const standalone = yield* Effect.tryPromise({
    try: async () => {
      if (!(await Bun.file(entrypoint).exists()))
        throw new Error(`OpenCode development entrypoint not found: ${entrypoint}`)
      if (!(await Bun.file(join(solid, "package.json")).exists()))
        throw new Error(`OpenCode development dependency not found: ${solid}; run bun install in ${root}`)
      const preload = join(artifacts, "node_modules", "@opentui", "solid")
      await mkdir(join(artifacts, "node_modules", "@opentui"), {
        recursive: true,
      })
      await rm(preload, { recursive: true, force: true })
      await symlink(solid, preload, "dir")
      return Bun.file(join(root, "packages", "cli", "src", "services", "standalone.ts")).exists()
    },
    catch: (cause) => instanceError("prepare development checkout", cause),
  })
  const preloads = [
    "--conditions=browser",
    `--preload=${join(solid, "scripts", "preload.js")}`,
  ]
  const base = [process.execPath, ...preloads, entrypoint]
  return {
    command: [...base, ...(standalone ? ["--standalone"] : [])],
    scriptedCommand: base,
    preloads,
  }
})
