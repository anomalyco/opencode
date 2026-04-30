import { isTelemetryEnabled, isUpdateCheckEnabled } from "./config.ts"
import { getInstallId } from "./install_id.ts"
import { firstRunNoticeIfNeeded } from "./notice.ts"
import { Transport } from "./transport.ts"
import { checkUpdate, detectInstallMethod } from "./update_check.ts"
import type { InitOptions, PlausibleEvent, TelemetryClient, UpdateInfo } from "./types.ts"

export type {
  ClientType,
  InitOptions,
  PlausibleEvent,
  TelemetryClient,
  UpdateInfo,
  InstallMethod,
} from "./types.ts"
export { getInstallId, defaultInstallIdDir, defaultInstallIdPath } from "./install_id.ts"
export { isTelemetryEnabled, isUpdateCheckEnabled, defaultConfigPath } from "./config.ts"
export { firstRunNoticeIfNeeded, resetNotice } from "./notice.ts"
export { checkUpdate, detectInstallMethod, defaultUpdateUrl } from "./update_check.ts"
export { Transport } from "./transport.ts"

const DEFAULT_TELEMETRY_ENDPOINT = "https://telemetry.deskfox.ai/api/event"

/**
 * Initialize the telemetry client.
 *
 * This is async because we read the config file and the install_id eagerly.
 * Clients should `await init(...)` once at startup, then keep the returned
 * client around for the rest of the process lifetime.
 *
 * If telemetry is disabled (per env / flag / config), the returned client
 * still has all methods — but `track`, `heartbeat`, and `flush` become no-ops
 * and never touch the network. `checkUpdate` honors a separate switch
 * (`OPENCODE_UPDATE_CHECK`) so users who opt out of telemetry can still
 * receive update notifications.
 */
export async function init(options: InitOptions): Promise<TelemetryClient> {
  // disableFlag=true means user passed --no-telemetry, i.e. *disable*.
  // Translate that to the `flag` parameter expected by isTelemetryEnabled
  // (which asks "is enabled?", so `false` to disable, `true` to force-enable).
  const flagForResolver: boolean | undefined =
    options.disableFlag === true ? false : options.disableFlag === false ? true : undefined

  const telemetryEnabled = await isTelemetryEnabled({
    flag: flagForResolver,
    configPath: options.configPath,
  }).catch(() => true)

  const updateCheckEnabled = await isUpdateCheckEnabled({
    configPath: options.configPath,
  }).catch(() => true)

  const installId = await getInstallId({ dir: options.installIdDir }).catch(() => "unknown")

  const baseProps: Record<string, string | number | boolean> = {
    version: options.appVersion,
    install_id: installId,
    os: process.platform,
    arch: process.arch,
  }

  const userAgent = `opencode-${options.clientType}/${options.appVersion} (${process.platform}; ${process.arch}; install=${shortId(installId)})`

  const transport = new Transport({
    endpoint: options.endpoints?.telemetry ?? DEFAULT_TELEMETRY_ENDPOINT,
    enabled: telemetryEnabled,
    userAgent,
    baseProps,
    fetchImpl: options.fetchImpl,
  })

  const domain = `opencode.${options.clientType}`

  const client: TelemetryClient = {
    track(name, props) {
      if (!telemetryEnabled) return
      const ev: PlausibleEvent = {
        name,
        url: "app://event",
        domain,
        props,
      }
      transport.enqueue(ev)
    },

    heartbeat() {
      if (!telemetryEnabled) return
      const ev: PlausibleEvent = {
        name: "pageview",
        url: "app://launch",
        domain,
      }
      transport.enqueue(ev)
    },

    async checkUpdate(): Promise<UpdateInfo | null> {
      if (!updateCheckEnabled) return null
      // CLI clients want install-method-aware upgrade strings; others don't.
      let installMethod
      if (options.clientType === "cli") {
        installMethod = await detectInstallMethod().catch(() => undefined)
      }
      return checkUpdate({
        clientType: options.clientType,
        appVersion: options.appVersion,
        url: options.endpoints?.update,
        fetchImpl: options.fetchImpl,
        cacheDir: options.cacheDir,
        installMethod,
      })
    },

    async firstRunNoticeIfNeeded(): Promise<string | null> {
      // If telemetry was already turned off at init time, there's nothing
      // to disclose — skip the notice.
      if (!telemetryEnabled) return null
      return firstRunNoticeIfNeeded()
    },

    async flush(): Promise<void> {
      try {
        await transport.flush()
      } catch {
        // never throw
      }
    },

    isEnabled() {
      return telemetryEnabled
    },

    isUpdateCheckEnabled() {
      return updateCheckEnabled
    },
  }

  return client
}

function shortId(id: string): string {
  if (id.length < 8) return id
  return id.slice(0, 8)
}
