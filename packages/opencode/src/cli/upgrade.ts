import { Config } from "@/config/config"
import { AppRuntime } from "@/effect/app-runtime"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Installation } from "@/installation"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { GlobalBus } from "@/bus/global"
import { checkRebase } from "@opencode-ai/script/check-update"

export async function upgrade() {
  const config = await AppRuntime.runPromise(Config.Service.use((cfg) => cfg.getGlobal()))
  if (config.autoupdate === false || Flag.OPENCODE_DISABLE_AUTOUPDATE) return
  const method = await Installation.method()
  const latest = await Installation.latest(method).catch(() => {})
  if (!latest) return

  // Run rebase check to see if custom branch would conflict with update
  const rebaseResult = await checkRebase().catch(() => null)

  if (Flag.OPENCODE_ALWAYS_NOTIFY_UPDATE) {
    emitRebaseCheck(rebaseResult, latest)
    return
  }

  if (InstallationVersion === latest) return

  const kind = Installation.getReleaseType(InstallationVersion, latest)

  if (config.autoupdate === "notify" || kind !== "patch") {
    emitRebaseCheck(rebaseResult, latest)
    return
  }

  if (method === "unknown") return

  // For auto-upgrade (patch), check rebase status first
  if (rebaseResult && rebaseResult.status !== "clean" && rebaseResult.status !== "fast-forward") {
    emitRebaseCheck(rebaseResult, latest)
    return
  }

  await Installation.upgrade(method, latest)
    .then(() =>
      GlobalBus.emit("event", {
        directory: "global",
        payload: {
          type: Installation.Event.Updated.type,
          properties: { version: latest },
        },
      }),
    )
    .catch(() => {})
}

function emitRebaseCheck(result: Awaited<ReturnType<typeof checkRebase>> | null, version: string) {
  if (!result) {
    // No rebase info available, fall back to simple update available
    GlobalBus.emit("event", {
      directory: "global",
      payload: {
        type: Installation.Event.UpdateAvailable.type,
        properties: { version },
      },
    })
    return
  }

  const statusMap: Record<string, "clean" | "conflicts" | "type-errors"> = {
    clean: "clean",
    "fast-forward": "clean",
    current: "clean",
    conflicts: "conflicts",
    "type-errors": "type-errors",
  }

  GlobalBus.emit("event", {
    directory: "global",
    payload: {
      type: Installation.Event.RebaseCheckReady.type,
      properties: {
        status: statusMap[result.status] ?? "clean",
        version,
        conflictingFiles: result.conflicts.length > 0 ? result.conflicts : undefined,
        typeErrors: result.compileErrors.length > 0 ? result.compileErrors : undefined,
      },
    },
  })
}
