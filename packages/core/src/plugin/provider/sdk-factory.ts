import { Effect } from "effect"
import { Npm } from "@opencode-ai/util/npm"
import { importModule, resolveModule } from "@opencode-ai/util/runtime-import"

export const loadSDKFactory = Effect.fnUntraced(function* (npm: Npm.Interface, packageName: string) {
  const installedPath = packageName.startsWith("file://")
    ? packageName
    : yield* npm.add(packageName).pipe(
        Effect.orDie,
        Effect.map((installed) => resolveModule(installed.name, installed.directory)),
      )

  const mod = (yield* Effect.promise(() => importModule(installedPath))) as Record<string, unknown>
  const match = Object.keys(mod).find((name) => name.startsWith("create"))
  if (!match) return yield* Effect.die(new Error(`Package ${packageName} has no provider factory export`))
  return mod[match]
})
