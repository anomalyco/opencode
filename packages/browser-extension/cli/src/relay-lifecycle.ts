import { Config, Effect, Result, Schedule, Schema } from "effect"
import { spawn } from "node:child_process"
import crypto from "node:crypto"
import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"
import { extensionReconnectAlarmPeriodMs } from "./protocol.ts"
import * as RelayClient from "./relay-client.ts"
import { RelayShutdownRequest, type ExtensionStatus, type RelayVersion } from "./relay-schema.ts"
import { opencodeBrowserBuildId } from "./version.ts"

// From source the CLI entry is main.ts next to this file; the published bundle is a single file, so it is this file.
const loadedCliEntrypoint = fileURLToPath(import.meta.url.endsWith(".ts") ? new URL("./main.ts", import.meta.url) : import.meta.url)
const clientInstanceId = crypto.randomUUID()

export type RelayReadiness = {
  readonly version: RelayVersion
  readonly started: boolean
  readonly buildProblem?: string
  readonly waitForReconnect?: true
}

export type EnsureRelayOptions = {
  readonly relay: RelayClient.Interface
  readonly start?: Effect.Effect<void, Error>
  readonly buildId?: string
  readonly retryTimes?: number
  readonly retryDelayMs?: number
}

export function shouldWaitForExtensionReconnect(readiness: RelayReadiness): boolean {
  return readiness.started || readiness.waitForReconnect === true
}

class RelayStillRunning extends Error {}

class RelayStartFailed extends Schema.TaggedError<RelayStartFailed>()(
  "RelayLifecycle.RelayStartFailed",
  {
    message: Schema.String,
    endpoint: Schema.String,
    cause: Schema.Defect(),
  },
) {}

export class ExtensionDisconnected extends Schema.TaggedError<ExtensionDisconnected>()(
  "RelayLifecycle.ExtensionDisconnected",
  { message: Schema.String },
) {}

export class ExtensionProtocolIncompatible extends Schema.TaggedError<ExtensionProtocolIncompatible>()(
  "RelayLifecycle.ExtensionProtocolIncompatible",
  {
    message: Schema.String,
    protocolVersion: Schema.NullOr(Schema.Number),
  },
) {}

export function relayBuildProblem(version: RelayVersion, buildId = opencodeBrowserBuildId): string | undefined {
  if (!version.buildId) {
    return `Running relay does not report a build id; use \`opencode-browser relay restart\` for upgrade guidance (${buildId}).`
  }
  if (version.buildId !== buildId) {
    if (isNewerBuild(version.buildId, buildId)) {
      return `Running relay build ${version.buildId} is newer than CLI build ${buildId}; refresh or restart this CLI or MCP client. Only use \`opencode-browser relay restart\` from the current installation.`
    }
    return `Running relay build ${version.buildId} does not match CLI build ${buildId}; run \`opencode-browser relay restart\` explicitly. This leaves browser tabs open but resets in-memory JavaScript state.`
  }
  return undefined
}

export const ensureRelay = Effect.fn("RelayLifecycle.ensureRelay")(function* (options: EnsureRelayOptions) {
  const buildId = options.buildId ?? opencodeBrowserBuildId
  const probe = options.relay.version
  const initial = yield* Effect.result(probe)
  if (Result.isSuccess(initial)) {
    const buildProblem = relayBuildProblem(initial.success, buildId)
    return {
      version: initial.success,
      started: false,
      ...(buildProblem ? { buildProblem } : {}),
    } satisfies RelayReadiness
  }
  const relayWasAbsent = isRelayUnreachable(initial.failure)
  if (!relayWasAbsent && !isRelayStarting(initial.failure)) {
    return yield* initial.failure
  }

  if (relayWasAbsent) {
    const autoStart = yield* Config.Boolean("OPENCODE_BROWSER_AUTOSTART").pipe(
      Config.withDefault(true),
      Effect.mapError((cause) => new Error("Invalid OPENCODE_BROWSER_AUTOSTART configuration", { cause })),
    )
    if (!autoStart) {
      return yield* Effect.fail(new Error(`Automatic relay startup is disabled; no relay is available at ${options.relay.endpoint}`))
    }
    yield* options.start ?? startManagedRelay()
  }
  const version = yield* waitForRelayReady(options)
  const buildProblem = relayBuildProblem(version, buildId)
  return { version, started: relayWasAbsent, ...(buildProblem ? { buildProblem } : {}) } satisfies RelayReadiness
})

function waitForRelayReady(options: EnsureRelayOptions): Effect.Effect<RelayVersion, Error | RelayClient.RelayClientError> {
  return options.relay.version.pipe(
    Effect.retry({
      times: options.retryTimes ?? 200,
      schedule: Schedule.spaced(options.retryDelayMs ?? 50),
      while: isRelayStartingOrUnreachable,
    }),
    Effect.mapError((error) => isRelayStartingOrUnreachable(error)
      ? new RelayStartFailed({
        message: `OpenCode Browser relay did not start at ${options.relay.endpoint}`,
        endpoint: options.relay.endpoint,
        cause: error,
      })
      : error),
  )
}

export const restartRelay = Effect.fn("RelayLifecycle.restartRelay")(function* (options: EnsureRelayOptions & {
  readonly clientKind?: RelayShutdownRequest["client"]["kind"]
}) {
  const buildId = options.buildId ?? opencodeBrowserBuildId
  const initial = yield* Effect.result(options.relay.version)
  let original: RelayVersion | undefined
  let replacement: RelayVersion | undefined
  let restartRequestId: string | undefined
  if (Result.isSuccess(initial)) {
    original = initial.success
  } else if (isRelayStarting(initial.failure)) {
    original = yield* waitForRelayReady(options)
  } else if (!isRelayUnreachable(initial.failure)) {
    return yield* initial.failure
  }

  if (original) {
    if (original.managed !== true || !original.instanceId) {
      return yield* Effect.fail(new Error("Cannot restart a foreground or unidentified relay. Stop it manually, then run `opencode-browser relay restart`."))
    }
    if (original.shutdownProtocol !== 2) {
      return yield* Effect.fail(new Error("This legacy relay does not support safe shutdown protocol 2. Stop it manually once, then run `opencode-browser relay restart` to upgrade; no shutdown request was sent."))
    }
    if (!Number.isFinite(Date.parse(buildId)) || !original.buildId || !Number.isFinite(Date.parse(original.buildId))) {
      return yield* Effect.fail(new Error("Cannot explicitly replace a source or unorderable relay build. Stop it manually, then launch the intended build."))
    }
    if (isNewerBuild(original.buildId, buildId)) {
      return yield* Effect.fail(new Error(`Refusing to downgrade relay build ${original.buildId} to ${buildId}; refresh or restart this CLI or MCP client.`))
    }

    const confirmed = yield* Effect.result(options.relay.version)
    if (Result.isFailure(confirmed)) {
      if (!isRelayUnreachable(confirmed.failure)) return yield* confirmed.failure
    } else if (!isSameRelayInstance(original, confirmed.success)) {
      replacement = confirmed.success
    } else {
      if (confirmed.success.managed !== true || confirmed.success.shutdownProtocol !== 2 || confirmed.success.buildId !== original.buildId) {
        return yield* Effect.fail(new Error("Relay identity metadata changed during restart; no shutdown request was sent."))
      }
      const request = yield* RelayShutdownRequest.makeEffect({
        instanceId: original.instanceId,
        requestId: crypto.randomUUID(),
        reason: "explicit-restart",
        client: { kind: options.clientKind ?? "sdk", instanceId: clientInstanceId, buildId },
      })
      const shutdown = yield* Effect.result(options.relay.shutdown(request))
      if (Result.isSuccess(shutdown)) restartRequestId = request.requestId
      else if (!isRelayUnreachable(shutdown.failure) && !isRelayInstanceChanged(shutdown.failure)) {
        return yield* shutdown.failure
      }
      replacement = yield* waitForRelayExitOrReplacement({ ...options, version: original })
    }
  }

  const started = replacement === undefined
  if (started) {
    yield* options.start ?? startManagedRelay(undefined, undefined, undefined, { ...(restartRequestId ? { restartRequestId } : {}) })
    replacement = yield* waitForRelayReady(options)
  }
  if (!replacement || !replacement.instanceId || replacement.managed !== true || (original && isSameRelayInstance(original, replacement))) {
    return yield* Effect.fail(new Error("Relay restart did not produce a new managed instance; no further shutdown was attempted."))
  }
  const buildProblem = relayBuildProblem(replacement, buildId)
  if (buildProblem) return yield* Effect.fail(new Error(`${buildProblem} A competing relay was left untouched.`))
  return { version: replacement, started, waitForReconnect: true } satisfies RelayReadiness
})

function waitForRelayExitOrReplacement(options: {
  readonly relay: RelayClient.Interface
  readonly version: RelayVersion
  readonly retryTimes?: number
  readonly retryDelayMs?: number
}): Effect.Effect<RelayVersion | undefined, Error | RelayClient.RelayClientError> {
  return options.relay.version.pipe(
    Effect.flatMap((version) => isSameRelayInstance(options.version, version)
      ? Effect.fail(new RelayStillRunning("OpenCode Browser relay is still draining; no replacement was started"))
      : Effect.succeed(version)),
    Effect.catch((error) => isRelayUnreachable(error) ? Effect.succeed(undefined) : Effect.fail(error)),
    Effect.retry({
      times: options.retryTimes ?? 200,
      schedule: Schedule.spaced(options.retryDelayMs ?? 50),
      while: (error) => error instanceof RelayStillRunning || isRelayStarting(error),
    }),
  )
}

function isSameRelayInstance(left: RelayVersion, right: RelayVersion): boolean {
  return left.instanceId !== undefined && left.instanceId === right.instanceId
}

function isNewerBuild(current: string, running: string | undefined): boolean {
  if (!running) return false
  const currentTime = Date.parse(current)
  const runningTime = Date.parse(running)
  return Number.isFinite(currentTime) && Number.isFinite(runningTime) && currentTime > runningTime
}

function isRelayInstanceChanged(error: unknown): boolean {
  return error instanceof RelayClient.RelayRejected && error.status === 409 && error.code === "invalid-request"
}

// Cover one full reconnect alarm period plus margin for the worker to connect.
export const extensionReconnectWaitMs = extensionReconnectAlarmPeriodMs + 5_000
const extensionReconnectProbeMs = 200

export const ensureExtensionConnected = Effect.fn("RelayLifecycle.ensureExtensionConnected")(function* (options: {
  readonly relay: RelayClient.Interface
  readonly waitForReconnect?: boolean
  readonly retryTimes?: number
  readonly retryDelayMs?: number
  /** Runs once, when the first probe finds the extension disconnected. */
  readonly onWait?: Effect.Effect<void>
}) {
  const check = options.relay.extensionStatus.pipe(Effect.flatMap((status): Effect.Effect<
    ExtensionStatus,
    ExtensionProtocolIncompatible | ExtensionDisconnected
  > => {
    if (status.protocolCompatible === false) {
      return Effect.fail(new ExtensionProtocolIncompatible({
        message: `OpenCode Browser extension protocol ${status.protocolVersion ?? "unknown"} is incompatible with this relay.`,
        protocolVersion: status.protocolVersion ?? null,
      }))
    }
    return status.connected
      ? Effect.succeed(status)
      : Effect.fail(new ExtensionDisconnected({
        message: "OpenCode Browser extension is not connected. Open the browser with OpenCode Browser installed (`npx opencode-browser-cli install`); it reconnects automatically after relay or browser startup.",
      }))
  }))
  if (!options.waitForReconnect) {
    return yield* check
  }
  let waitAnnounced = false
  return yield* check.pipe(
    Effect.tapError((error) => {
      if (waitAnnounced || !options.onWait || !(error instanceof ExtensionDisconnected)) return Effect.void
      waitAnnounced = true
      return options.onWait
    }),
    Effect.retry({
      times: options.retryTimes ?? Math.ceil(extensionReconnectWaitMs / extensionReconnectProbeMs),
      schedule: Schedule.spaced(options.retryDelayMs ?? extensionReconnectProbeMs),
      while: (error) => error instanceof ExtensionDisconnected || isRelayStartingOrUnreachable(error),
    }),
  )
})

export function stoppedRelayStatus(endpoint: string): {
  readonly endpoint: string
  readonly relay: { readonly running: false }
  readonly extension: null
  readonly sessions: readonly []
  readonly targets: readonly []
} {
  return { endpoint, relay: { running: false }, extension: null, sessions: [], targets: [] }
}

export function statusCollections(status: ExtensionStatus): {
  readonly sessions: NonNullable<ExtensionStatus["sessions"]>
  readonly targets: NonNullable<ExtensionStatus["targets"]>
} | undefined {
  return status.sessions && status.targets ? { sessions: status.sessions, targets: status.targets } : undefined
}

export function startManagedRelay(
  entrypoint = loadedCliEntrypoint,
  executable = process.execPath,
  execArgv: readonly string[] = process.execArgv,
  options: { readonly restartRequestId?: string } = {},
): Effect.Effect<void, Error> {
  return Effect.try({
    try: () => {
      if (!entrypoint) {
        throw new Error("Cannot locate the opencode-browser CLI entrypoint")
      }
      const launch = managedRelayLaunch(entrypoint, executable, execArgv)
      const { OPENCODE_BROWSER_RESTART_REQUEST_ID: _inheritedRestartRequestId, ...env } = process.env
      const child = spawn(launch.executable, launch.args, {
        detached: true,
        stdio: "ignore",
        env: { ...env, OPENCODE_BROWSER_MANAGED_RELAY: "1", ...(options.restartRequestId ? { OPENCODE_BROWSER_RESTART_REQUEST_ID: options.restartRequestId } : {}) },
      })
      child.unref()
    },
    catch: (cause) => cause instanceof Error ? cause : new Error("Failed to start OpenCode Browser relay", { cause }),
  })
}

export function managedRelayLaunch(
  entrypoint = loadedCliEntrypoint,
  executable = process.execPath,
  execArgv: readonly string[] = process.execArgv,
): { readonly executable: string; readonly args: string[] } {
  return {
    executable,
    args: [...execArgv, managedRelayEntrypoint(entrypoint), "serve"],
  }
}

export function managedRelayEntrypoint(entrypoint: string): string {
  const name = path.basename(entrypoint)
  if (name === "mcp-main.ts" || name === "index.ts" || name === "opencode-browser-client.ts" || name === "cli.ts")
    return path.join(path.dirname(entrypoint), "main.ts")
  return entrypoint
}

function isRelayUnreachable(error: unknown): error is RelayClient.RelayUnreachable {
  return error instanceof RelayClient.RelayUnreachable
}

function isRelayStarting(error: unknown): error is RelayClient.RelayRejected {
  return error instanceof RelayClient.RelayRejected && error.code === "relay-starting"
}

function isRelayStartingOrUnreachable(error: unknown): error is RelayClient.RelayRejected | RelayClient.RelayUnreachable {
  return isRelayStarting(error) || isRelayUnreachable(error)
}
