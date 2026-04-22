import path from "path"
import { Effect } from "effect"
import { EffectLogger } from "@/effect"
import { InstanceState } from "@/effect"
import { Instance } from "../project/instance"
import { AppFileSystem } from "@opencode-ai/shared/filesystem"

type Kind = "file" | "directory"

type Options = {
  bypass?: boolean
  kind?: Kind
}

type ToolContext = {
  ask(input: {
    permission: string
    patterns: string[]
    always: string[]
    metadata: Readonly<Record<string, unknown>>
  }): Promise<void> | Effect.Effect<void>
}

const ask = (ctx: ToolContext, input: Parameters<ToolContext["ask"]>[0]) => {
  const result = ctx.ask(input)
  if (result && typeof result === "object" && "then" in result) {
    return result as Promise<void>
  }
  return Effect.runPromise(result as Effect.Effect<void>)
}

export const assertExternalDirectoryEffect = Effect.fn("Tool.assertExternalDirectory")(function* (
  ctx: ToolContext,
  target?: string,
  options?: Options,
) {
  if (!target) return

  if (options?.bypass) return

  const ins = yield* InstanceState.context
  const full = process.platform === "win32" ? AppFileSystem.normalizePath(target) : target
  if (Instance.containsPath(full, ins)) return

  const kind = options?.kind ?? "file"
  const dir = kind === "directory" ? full : path.dirname(full)
  const glob =
    process.platform === "win32"
      ? AppFileSystem.normalizePathPattern(path.join(dir, "*"))
      : path.join(dir, "*").replaceAll("\\", "/")

  yield* Effect.promise(() =>
    ask(ctx, {
      permission: "external_directory",
      patterns: [glob],
      always: [glob],
      metadata: {
        filepath: full,
        parentDir: dir,
      },
    }),
  )
})

export async function assertExternalDirectory(ctx: ToolContext, target?: string, options?: Options) {
  return Effect.runPromise(assertExternalDirectoryEffect(ctx, target, options).pipe(Effect.provide(EffectLogger.layer)))
}
