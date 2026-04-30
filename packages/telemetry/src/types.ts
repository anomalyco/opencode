/**
 * Shared types for the @opencode-ai/telemetry package.
 *
 * The public surface is intentionally small. The three client integrations
 * (cli / desktop / web) each call `init()` from `index.ts` which returns a
 * `TelemetryClient` exposing the methods listed below.
 */

/** Which client is using the telemetry SDK. Drives the Plausible `domain` and update endpoint. */
export type ClientType = "cli" | "desktop" | "web"

export interface InitOptions {
  /** Required: which client. Determines update endpoint path and event domain. */
  clientType: ClientType
  /** Required: client app version (semver string, e.g. "1.2.3"). */
  appVersion: string
  /** Optional: explicit boolean override from a CLI flag (e.g. `--no-telemetry`).
   *  `false` => disable telemetry. `undefined` => fall through to env / config / default. */
  disableFlag?: boolean
  /** Optional: full path to the user's `config.json`. Defaults to `~/.config/opencode/config.json`. */
  configPath?: string
  /** Optional: override base URLs (mostly for testing).
   *  Defaults: telemetry → https://telemetry.deskfox.ai/api/event;
   *            update    → https://updates.deskfox.ai/v1/latest/<clientType>/latest.json */
  endpoints?: {
    telemetry?: string
    update?: string
  }
  /** Optional: inject a fetch implementation (mostly for testing). Defaults to global `fetch`. */
  fetchImpl?: typeof fetch
  /** Optional: override the cache dir (mostly for testing). */
  cacheDir?: string
  /** Optional: override the config dir for `install_id` (mostly for testing).
   *  Note: we store install_id in cache dir to avoid cloud-sync drift; this is the cache dir override. */
  installIdDir?: string
}

/** Plausible event payload (we wrap it in a small typed shape). */
export interface PlausibleEvent {
  /** Plausible event name. Use `pageview` for heartbeat; otherwise our custom event name. */
  name: string
  /** Virtual url. We use `app://launch` for heartbeat and `app://event` for custom events. */
  url: string
  /** Plausible site domain. We embed the client kind: `opencode.cli` / `opencode.desktop` / `opencode.web`. */
  domain: string
  /** Custom props. `version` and `install_id` are always added by transport.send. */
  props?: Record<string, string | number | boolean>
}

/** Result of a fresh update check. */
export interface UpdateInfo {
  hasUpdate: boolean
  /** The latest version reported by the server. May equal the local version (then `hasUpdate=false`). */
  latest: string
  /** Time the latest was released, ISO 8601. */
  releasedAt?: string
  /** Min supported version — if local < min_supported, this is a forced upgrade. */
  minSupportedVersion?: string
  /** Pre-formatted command appropriate for the user's install method (CLI only). */
  upgradeCommand?: string
  /** Raw upgrade-commands map from the server, keyed by install method. */
  upgradeCommands?: Record<string, string>
  /** URL to release notes. */
  releaseNotesUrl?: string
  /** True if this release is flagged as a security update (priority bump in UI). */
  isSecurityUpdate?: boolean
}

/** Detected install method for the CLI; used to pick `upgradeCommand`. */
export type InstallMethod = "npm" | "bun" | "brew" | "curl" | "unknown"

/** Public client returned from `init()`. */
export interface TelemetryClient {
  /** Track a custom event. Fire-and-forget. No-op if telemetry disabled. */
  track(name: string, props?: Record<string, string | number | boolean>): void
  /** Send a heartbeat (mapped to a Plausible pageview). Fire-and-forget. No-op if disabled. */
  heartbeat(): void
  /** Check for an update. Reads cache (24h) before hitting the network. Returns null on full failure. */
  checkUpdate(): Promise<UpdateInfo | null>
  /** Show the first-run notice if we haven't shown it yet. Returns the notice text (or null if already shown / disabled). */
  firstRunNoticeIfNeeded(): Promise<string | null>
  /** Force-flush any buffered events. Useful before exit. Fire-and-forget — never throws. */
  flush(): Promise<void>
  /** Whether telemetry is currently enabled (after env/flag/config resolution). */
  isEnabled(): boolean
  /** Whether update-check is currently enabled (independent switch). */
  isUpdateCheckEnabled(): boolean
}

/** A serialized cached update-check response. */
export interface CachedUpdateCheck {
  fetchedAt: number
  data: UpdateInfo
}
