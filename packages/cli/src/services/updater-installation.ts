import { Global } from "@opencode-ai/util/global"
import { AppProcess } from "@opencode-ai/util/process"
import { Effect, FileSystem } from "effect"
import { ChildProcess } from "effect/unstable/process"
import path from "node:path"
import type { Method } from "./updater"

type Installation = { method: Method; package?: string }
type Inventory = { dependencies?: Record<string, { path: string }> }

export const detectInstallation = Effect.fnUntraced(
  function* (input: string) {
    const fs = yield* FileSystem.FileSystem
    const global = yield* Global.Service
    const appProcess = yield* AppProcess.Service
    const executable = yield* fs.realPath(input)
    if (
      executable ===
      path.join(global.home, ".opencode", "bin", process.platform === "win32" ? "opencode2.exe" : "opencode2")
    ) {
      return [{ method: "curl" } satisfies Installation]
    }

    const matches = (files: string[]) =>
      Effect.forEach(files, (file) =>
        fs.realPath(file).pipe(
          Effect.map((resolved) => resolved === executable),
          Effect.orElseSucceed(() => false),
        ),
      ).pipe(Effect.map((results) => results.some(Boolean)))

    const checks = [
      { method: "npm", args: ["list", "--global", "--depth=0", "--json", "--long"] },
      { method: "pnpm", args: ["list", "--global", "--depth=0", "--json", "--long"] },
      { method: "bun", args: ["pm", "bin", "--global"] },
      { method: "yarn", args: ["global", "dir", "--silent"] },
    ] as const
    const owners = yield* Effect.forEach(
      checks,
      (check) =>
        Effect.gen(function* (): Effect.fn.Return<Installation[], unknown> {
          const result = yield* appProcess.run(ChildProcess.make(check.method, check.args, { cwd: global.home }), {
            timeout: "10 seconds",
            maxOutputBytes: 1_000_000,
            maxErrorBytes: 100_000,
          })
          if (result.exitCode !== 0) return []
          const output = result.stdout.toString("utf8").trim()
          if (check.method === "bun") {
            const files = yield* fs.readDirectory(output)
            return (yield* matches(files.map((file) => path.join(output, file)))) ? [{ method: "bun" }] : []
          }

          const packages =
            check.method === "yarn"
              ? yield* fs.readFileString(path.join(output, "package.json")).pipe(
                  Effect.flatMap((text) =>
                    Effect.try(() => {
                      const manifest: { dependencies?: Record<string, string> } = JSON.parse(text)
                      return Object.keys(manifest.dependencies ?? {}).map((name) => ({
                        name,
                        path: path.join(output, "node_modules", name),
                      }))
                    }),
                  ),
                )
              : yield* Effect.try(() => {
                  const inventories: Inventory[] = check.method === "npm" ? [JSON.parse(output)] : JSON.parse(output)
                  return inventories.flatMap((inventory) =>
                    Object.entries(inventory.dependencies ?? {}).map(([name, pkg]) => ({ name, path: pkg.path })),
                  )
                })
          const found = yield* Effect.forEach(packages, (pkg) =>
            Effect.gen(function* () {
              const manifest: { bin?: string | Record<string, string> } = yield* fs
                .readFileString(path.join(pkg.path, "package.json"))
                .pipe(Effect.flatMap((text) => Effect.try(() => JSON.parse(text))))
              const bins = typeof manifest.bin === "string" ? [manifest.bin] : Object.values(manifest.bin ?? {})
              if (yield* matches(bins.map((bin) => path.resolve(pkg.path, bin))))
                return { method: check.method, package: pkg.name }
            }).pipe(Effect.orElseSucceed(() => undefined)),
          )
          return found.filter((owner) => owner !== undefined)
        }).pipe(Effect.orElseSucceed(() => [])),
      { concurrency: "unbounded" },
    )
    return owners.flat()
  },
  Effect.orElseSucceed(() => []),
)
