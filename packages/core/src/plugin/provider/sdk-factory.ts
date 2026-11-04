import { Effect } from "effect"
import { Npm } from "@opencode/util/npm"
import { importModule, resolveModule } from "@opencode/util/runtime-import"

export const loadSDKFactory = Effect.fnUntraced(function* (npm: Npm.Interface, packageName: string) {
  const installedPath = packageName.startsWith("file://")
    ? packageName
    : yield* npm.add(installSpec(packageName)).pipe(
        Effect.orDie,
        Effect.map((installed) => resolveModule(installed.name, installed.directory)),
      )

  const mod = (yield* Effect.promise(() => importModule(installedPath))) as Record<string, unknown>
  const match = Object.keys(mod).find((name) => name.startsWith("create"))
  if (!match) return yield* Effect.die(new Error(`Package ${packageName} has no provider factory export`))
  return mod[match]
})

// The AI SDK bridge only supports AI SDK v6 providers. Official `@ai-sdk/*` packages now publish AI SDK v7 under
// `latest` and keep the v6 line under the `ai-v6` dist-tag, so an unversioned official package installs that tag.
// An explicit version, range, or tag is installed as written.
function installSpec(packageName: string) {
  return /^@ai-sdk\/[^/@]+$/.test(packageName) ? `${packageName}@ai-v6` : packageName
}
