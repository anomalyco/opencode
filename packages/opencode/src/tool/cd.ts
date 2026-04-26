import path from "path"
import os from "os"
import z from "zod"
import { Effect } from "effect"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Instance } from "../project/instance"
import { InstanceBootstrap } from "../project/bootstrap"
import { AppRuntime } from "../effect/app-runtime"
import DESCRIPTION from "./cd.txt"
import * as Tool from "./tool"

export const CdTool = Tool.define(
  "cd",
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service

    return {
      description: DESCRIPTION,
      parameters: z.object({
        path: z.string().describe("The target directory path to change to. Supports absolute paths, relative paths, and ~ for home directory."),
      }),
      execute: (params: { path: string }, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          const trimmed = params.path.trim()
          if (!trimmed) throw new Error("path parameter is required")

          const expanded = trimmed.startsWith("~") ? path.join(os.homedir(), trimmed.slice(1)) : trimmed
          const resolved = path.isAbsolute(expanded)
            ? path.resolve(expanded)
            : path.resolve(Instance.directory, expanded)

          const stat = yield* fs.stat(resolved).pipe(Effect.catch(() => Effect.succeed(undefined)))
          if (!stat || stat.type !== "Directory") throw new Error(`directory not found: ${resolved}`)

          const previousDirectory = Instance.directory
          process.chdir(resolved)
          yield* Effect.promise(() =>
            Instance.reload({
              directory: resolved,
              init: () => AppRuntime.runPromise(InstanceBootstrap),
            }),
          )

          return {
            title: path.basename(resolved),
            metadata: {
              previousDirectory,
              newDirectory: resolved,
            },
            output: `Changed working directory to: ${resolved}`,
          }
        }).pipe(Effect.orDie),
    }
  }),
)
