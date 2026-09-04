import { Config } from "@/config/config"
import { AppRuntime } from "@/effect/app-runtime"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Installation } from "@/installation"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { GlobalBus } from "@/bus/global"

function emit(type: string, version: string) {
  GlobalBus.emit("event", {
    directory: "global",
    payload: { type, properties: { version } },
  })
}

// Runs once shortly after the TUI starts (cli/cmd/tui.ts schedules it, cli/tui/worker.ts calls it).
// Differences from upstream opencode: an unset `autoupdate` notifies instead of installing
// patch releases silently, and versions go through Installation.compareVersions because
// Mammouth Code release tags can have four segments (1.17.11.2), which semver rejects.
export async function upgrade() {
  if (Flag.OPENCODE_DISABLE_AUTOUPDATE) return
  // Dev builds report "local" and have nothing to compare against. The flag still forces the
  // notification so the dialog can be exercised with `bun run dev`.
  if (Installation.isLocal() && !Flag.OPENCODE_ALWAYS_NOTIFY_UPDATE) return

  const config = await AppRuntime.runPromise(Config.Service.use((cfg) => cfg.getGlobal()))
  const autoupdate = config.autoupdate ?? "notify"
  if (autoupdate === false) return

  const method = await Installation.method()
  const latest = await Installation.latest(method).catch(() => {})
  if (!latest) return

  if (Flag.OPENCODE_ALWAYS_NOTIFY_UPDATE) {
    emit(Installation.Event.UpdateAvailable.type, latest)
    return
  }

  if (Installation.compareVersions(latest, InstallationVersion) <= 0) return

  const kind = Installation.getReleaseType(InstallationVersion, latest)
  if (autoupdate === "notify" || kind !== "patch") {
    emit(Installation.Event.UpdateAvailable.type, latest)
    return
  }

  if (method === "unknown") return
  await Installation.upgrade(method, latest)
    .then(() => emit(Installation.Event.Updated.type, latest))
    .catch(() => {})
}
