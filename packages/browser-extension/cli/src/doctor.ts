import { Effect, FileSystem, Path, Schema } from "effect"
import * as RelayClient from "./relay-client.ts"
import { relayBuildProblem } from "./relay-lifecycle.ts"
import type { ExtensionStatus, RelayVersion, SessionSummary, TargetSummary } from "./relay-schema.ts"
import { extensionProtocolVersion } from "./protocol.ts"
import * as SessionStore from "./session-store.ts"
import { opencodeBrowserBuildId, opencodeBrowserVersion } from "./version.ts"

/**
 * Read-only local install and runtime diagnostics. Pure report construction
 * over RelayClient/SessionStore/FileSystem probes; never fails, degrades to
 * warn/fail checks instead.
 */

export type ProbeResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string }

const PackageMetadata = Schema.Struct({
  name: Schema.String,
  version: Schema.String,
  bin: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
})

const ManifestVersion = Schema.Struct({
  version: Schema.String,
})
const bundledExtensionManifestPath = "extension/manifest.json"

type PackageInfo = {
  readonly name: string
  readonly version: string
  readonly bin: {
    readonly opencodeBrowser: string | null
    readonly opencodeBrowserMcp: string | null
  }
}

type DoctorArtifact = {
  readonly path: string
  readonly exists: boolean
  readonly version?: string
}

export type DoctorCheckStatus = "ok" | "warn" | "fail"

export type DoctorCheck = {
  readonly id: string
  readonly label: string
  readonly status: DoctorCheckStatus
  readonly message: string
}

export type DoctorReport = {
  readonly status: DoctorCheckStatus
  readonly endpoint: string
  readonly cli: {
    readonly version: string
    readonly buildId: string
  }
  readonly package: {
    readonly path: string
    readonly name: string | null
    readonly version: string | null
    readonly bin: {
      readonly opencodeBrowser: boolean
      readonly opencodeBrowserMcp: boolean
    }
    readonly error: string | null
  }
  readonly relay: {
    readonly reachable: boolean
    readonly version: string | null
    readonly buildId: string | null
    readonly buildMatches: boolean | null
    readonly error: string | null
  }
  readonly extension: {
    readonly connected: boolean | null
    readonly version: string | null
    readonly expectedVersion: string | null
    readonly versionMatches: boolean | null
    readonly protocolVersion: number | null
    readonly expectedProtocolVersion: number
    readonly protocolCompatible: boolean | null
    readonly protocolLegacy: boolean | null
    readonly rejectedConnections: number | null
    readonly error: string | null
  }
  readonly targets: {
    readonly active: number | null
    readonly child: number | null
    readonly relayOwned: readonly TargetSummary[]
    readonly unhealthy: readonly TargetSummary[]
    readonly all: readonly TargetSummary[]
    readonly error: string | null
  }
  readonly sessions: {
    readonly current: string | null
    readonly staleCurrent: boolean
    readonly possibleLeaked: readonly SessionSummary[]
    readonly all: readonly SessionSummary[]
    readonly error: string | null
  }
  readonly artifacts: readonly DoctorArtifact[]
  readonly checks: readonly DoctorCheck[]
  readonly recommendations: readonly string[]
}

const probe = <A, E>(effect: Effect.Effect<A, E>): Effect.Effect<ProbeResult<A>> =>
  effect.pipe(
    Effect.match({
      onFailure: (error) => ({ ok: false, error: errorMessage(error) } as const),
      onSuccess: (value) => ({ ok: true, value } as const),
    }),
  )

const errorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

export const createDoctorReport = Effect.fn("Doctor.createReport")(function* (options: {
  readonly packageRoot: string
}) {
  const relay = yield* RelayClient.Service
  const store = yield* SessionStore.Service
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path

  const readJsonFile = <A>(relativePath: string, schema: Schema.ConstraintDecoder<A>): Effect.Effect<A, Error> =>
    fs.readFileString(path.join(options.packageRoot, relativePath)).pipe(
      Effect.mapError((cause) => new Error(`read ${relativePath}: ${cause.reason.message}`)),
      Effect.flatMap((text) =>
        Effect.try({
          try: () => JSON.parse(text) as unknown,
          catch: () => new Error(`parse ${relativePath}: invalid JSON`),
        })
      ),
      Effect.flatMap((value) =>
        Schema.decodeUnknownEffect(schema)(value).pipe(
          Effect.mapError((cause) => new Error(`decode ${relativePath}: ${cause.message}`)),
        )
      ),
    )

  const readPackageInfo: Effect.Effect<PackageInfo, Error> = readJsonFile("package.json", PackageMetadata).pipe(
    Effect.map((metadata) => ({
      name: metadata.name,
      version: metadata.version,
      bin: {
        opencodeBrowser: metadata.bin?.["opencode-browser"] ?? null,
        opencodeBrowserMcp: metadata.bin?.["opencode-browser-mcp"] ?? null,
      },
    })),
  )

  const readManifestVersion = (relativePath: string): Effect.Effect<string, Error> =>
    readJsonFile(relativePath, ManifestVersion).pipe(Effect.map((manifest) => manifest.version))

  const fileExists = (relativePath: string): Effect.Effect<boolean> =>
    fs.exists(path.join(options.packageRoot, relativePath)).pipe(
      Effect.orElseSucceed(() => false),
    )

  const [packageResult, bundledManifestVersion, distCliExists, distMcpExists, extensionDistManifestExists, currentResult] = yield* Effect.all([
    probe(readPackageInfo),
    probe(readManifestVersion(bundledExtensionManifestPath)),
    fileExists("dist/cli.mjs"),
    fileExists("dist/cli.mjs"),
    fileExists(bundledExtensionManifestPath),
    probe(store.read),
  ])
  const relayResult = yield* probe(relay.version)
  const relayBuildMatches = relayResult.ok
    ? relayResult.value.buildId
      ? relayBuildProblem(relayResult.value, opencodeBrowserBuildId) === undefined
      : null
    : null
  const [extensionResult, targetsResult, sessionsResult] = relayResult.ok
    ? yield* Effect.all([
      probe(relay.extensionStatus),
      probe(relay.targets),
      probe(relay.sessions),
    ])
    : [
      { ok: false, error: relayResult.error } satisfies ProbeResult<ExtensionStatus>,
      { ok: false, error: relayResult.error } satisfies ProbeResult<readonly TargetSummary[]>,
      { ok: false, error: relayResult.error } satisfies ProbeResult<readonly SessionSummary[]>,
    ]
  const expectedVersion = bundledManifestVersion.ok ? bundledManifestVersion.value : null
  const extensionVersion = extensionResult.ok ? extensionResult.value.version : null
  const extensionVersionMatches = extensionResult.ok && extensionVersion && expectedVersion ? extensionVersion === expectedVersion : null
  const current = currentResult.ok ? currentResult.value ?? null : null
  const targets = targetsResult.ok ? targetsResult.value : []
  const sessions = sessionsResult.ok ? sessionsResult.value : []
  const staleCurrent = Boolean(current && sessionsResult.ok && !sessions.some((session) => {
    return session.id === current
  }))
  const relayOwnedTargets = targets.filter((target) => {
    return target.owner === "relay"
  })
  const unhealthyTargets = targets.filter((target) => {
    return target.crashed === true || target.url.startsWith("chrome-error://")
  })
  const possibleLeakedSessions = sessions.filter((session) => {
    return session.connected && session.id !== current
  })
  const artifacts: readonly DoctorArtifact[] = [
    { path: "dist/cli.mjs", exists: distCliExists && distMcpExists },
    {
      path: bundledExtensionManifestPath,
      exists: extensionDistManifestExists,
      ...(bundledManifestVersion.ok ? { version: bundledManifestVersion.value } : {}),
    },
  ]
  const checks = buildDoctorChecks({
    packageResult,
    relayResult,
    extensionResult,
    bundledManifestVersion,
    artifacts,
    currentResult,
    staleCurrent,
    relayOwnedTargets,
    unhealthyTargets,
    possibleLeakedSessions,
    targetsResult,
    sessionsResult,
  })
  const report: DoctorReport = {
    status: summarizeCheckStatus(checks),
    endpoint: relay.endpoint,
    cli: { version: opencodeBrowserVersion, buildId: opencodeBrowserBuildId },
    package: {
      path: path.join(options.packageRoot, "package.json"),
      name: packageResult.ok ? packageResult.value.name : null,
      version: packageResult.ok ? packageResult.value.version : null,
      bin: {
        opencodeBrowser: packageResult.ok ? Boolean(packageResult.value.bin.opencodeBrowser) : false,
        opencodeBrowserMcp: packageResult.ok ? Boolean(packageResult.value.bin.opencodeBrowserMcp) : false,
      },
      error: packageResult.ok ? null : packageResult.error,
    },
    relay: {
      reachable: relayResult.ok,
      version: relayResult.ok ? relayResult.value.version : null,
      buildId: relayResult.ok ? relayResult.value.buildId ?? null : null,
      buildMatches: relayBuildMatches,
      error: relayResult.ok ? null : relayResult.error,
    },
    extension: {
      connected: extensionResult.ok ? extensionResult.value.connected : null,
      version: extensionVersion,
      expectedVersion,
      versionMatches: extensionVersionMatches,
      protocolVersion: extensionResult.ok ? extensionResult.value.protocolVersion ?? null : null,
      expectedProtocolVersion: extensionProtocolVersion,
      protocolCompatible: extensionResult.ok ? extensionResult.value.protocolCompatible ?? null : null,
      protocolLegacy: extensionResult.ok ? extensionResult.value.protocolLegacy ?? null : null,
      rejectedConnections: extensionResult.ok ? extensionResult.value.rejectedConnections ?? null : null,
      error: extensionResult.ok ? null : extensionResult.error,
    },
    targets: {
      active: extensionResult.ok ? extensionResult.value.activeTargets : null,
      child: extensionResult.ok ? extensionResult.value.childTargets ?? null : null,
      relayOwned: relayOwnedTargets,
      unhealthy: unhealthyTargets,
      all: targets,
      error: targetsResult.ok ? null : targetsResult.error,
    },
    sessions: {
      current,
      staleCurrent,
      possibleLeaked: possibleLeakedSessions,
      all: sessions,
      error: sessionsResult.ok ? currentResult.ok ? null : currentResult.error : sessionsResult.error,
    },
    artifacts,
    checks,
    recommendations: buildDoctorRecommendations({
      relayResult,
      extensionResult,
      artifacts,
      staleCurrent,
      current,
      unhealthyTargets,
    }),
  }
  return report
})

function buildDoctorChecks(options: {
  readonly packageResult: ProbeResult<PackageInfo>
  readonly relayResult: ProbeResult<RelayVersion>
  readonly extensionResult: ProbeResult<ExtensionStatus>
  readonly bundledManifestVersion: ProbeResult<string>
  readonly artifacts: readonly DoctorArtifact[]
  readonly currentResult: ProbeResult<string | undefined>
  readonly staleCurrent: boolean
  readonly relayOwnedTargets: readonly TargetSummary[]
  readonly unhealthyTargets: readonly TargetSummary[]
  readonly possibleLeakedSessions: readonly SessionSummary[]
  readonly targetsResult: ProbeResult<readonly TargetSummary[]>
  readonly sessionsResult: ProbeResult<readonly SessionSummary[]>
}): readonly DoctorCheck[] {
  const packageBinChecks: readonly DoctorCheck[] = options.packageResult.ok
    ? [
      {
        id: "bin-opencode-browser",
        label: "opencode-browser bin",
        status: options.packageResult.value.bin.opencodeBrowser ? "ok" : "fail",
        message: options.packageResult.value.bin.opencodeBrowser ?? "missing from package.json bin",
      },
      {
        id: "bin-opencode-browser-mcp",
        label: "opencode-browser-mcp bin",
        status: options.packageResult.value.bin.opencodeBrowserMcp ? "ok" : "warn",
        message: options.packageResult.value.bin.opencodeBrowserMcp ?? "missing from package.json bin",
      },
    ]
    : []
  const artifactChecks = options.artifacts.map((artifact): DoctorCheck => {
    return {
      id: `artifact-${artifact.path}`,
      label: artifact.path,
      status: artifact.exists ? "ok" : "warn",
      message: artifact.exists ? artifact.version ? `exists (${artifact.version})` : "exists" : "missing; prepare a fresh runtime",
    }
  })
  return [
    {
      id: "package-metadata",
      label: "package metadata",
      status: options.packageResult.ok ? "ok" : "fail",
      message: options.packageResult.ok ? `${options.packageResult.value.name} ${options.packageResult.value.version}` : options.packageResult.error,
    },
    ...packageBinChecks,
    {
      id: "relay-http",
      label: "relay HTTP endpoint",
      status: options.relayResult.ok ? "ok" : "fail",
      message: options.relayResult.ok ? `reachable (${options.relayResult.value.version})` : options.relayResult.error,
    },
    relayBuildCheck({ relayResult: options.relayResult, cliBuildId: opencodeBrowserBuildId }),
    {
      id: "extension-connected",
      label: "extension connection",
      status: options.extensionResult.ok && options.extensionResult.value.connected ? "ok" : "fail",
      message: options.extensionResult.ok ? options.extensionResult.value.connected ? `connected${options.extensionResult.value.version ? ` (${options.extensionResult.value.version})` : ""}` : "disconnected" : options.extensionResult.error,
    },
    extensionVersionCheck({
      extensionResult: options.extensionResult,
      bundledManifestVersion: options.bundledManifestVersion,
    }),
    extensionProtocolCheck(options.extensionResult),
    ...(options.extensionResult.ok && options.extensionResult.value.rejectedConnections !== undefined ? [{
      id: "extension-connection-conflicts",
      label: "competing browser connections",
      status: options.extensionResult.value.rejectedConnections > 0 ? "warn" as const : "ok" as const,
      message: options.extensionResult.value.rejectedConnections > 0
        ? `${options.extensionResult.value.rejectedConnections} connection attempt(s) rejected; the active browser connection was preserved`
        : "none observed on this connection",
    }] : []),
    {
      id: "targets-readable",
      label: "targets readable",
      status: options.targetsResult.ok ? "ok" : "fail",
      message: options.targetsResult.ok ? `${options.targetsResult.value.length} active root target(s)` : options.targetsResult.error,
    },
    unhealthyTargetsCheck({
      targetsResult: options.targetsResult,
      unhealthyTargets: options.unhealthyTargets,
    }),
    {
      id: "sessions-readable",
      label: "sessions readable",
      status: options.sessionsResult.ok ? "ok" : "fail",
      message: options.sessionsResult.ok ? `${options.sessionsResult.value.length} session(s)` : options.sessionsResult.error,
    },
    {
      id: "current-session-file",
      label: "current session file",
      status: options.currentResult.ok ? "ok" : "warn",
      message: options.currentResult.ok ? options.currentResult.value ?? "none" : options.currentResult.error,
    },
    {
      id: "current-session-stale",
      label: "current session membership",
      status: options.staleCurrent ? "warn" : "ok",
      message: options.staleCurrent ? "current session is not present in relay sessions" : "current session is valid or unset",
    },
    {
      id: "relay-owned-targets",
      label: "relay-owned active targets",
      status: "ok",
      message: options.relayOwnedTargets.length ? `${options.relayOwnedTargets.length} persistent relay-owned target(s)` : "none",
    },
    {
      id: "possible-leaked-sessions",
      label: "connected non-current sessions",
      status: "ok",
      message: options.possibleLeakedSessions.length ? `${options.possibleLeakedSessions.length} connected non-current session(s)` : "none",
    },
    ...artifactChecks,
  ]
}

const makeDoctorCheck = (id: string, label: string) => (status: DoctorCheckStatus, message: string): DoctorCheck => ({
  id,
  label,
  status,
  message,
})

export function unhealthyTargetsCheck(options: {
  readonly targetsResult: ProbeResult<readonly TargetSummary[]>
  readonly unhealthyTargets: readonly TargetSummary[]
}): DoctorCheck {
  const check = makeDoctorCheck("unhealthy-targets", "crashed or browser-error targets")
  if (!options.targetsResult.ok) {
    return check("warn", `target health unknown: ${options.targetsResult.error}`)
  }
  return check(
    options.unhealthyTargets.length ? "warn" : "ok",
    options.unhealthyTargets.length ? `${options.unhealthyTargets.length} unhealthy target(s)` : "none",
  )
}

export function relayBuildCheck(options: {
  readonly relayResult: ProbeResult<RelayVersion>
  readonly cliBuildId: string
}): DoctorCheck {
  const check = makeDoctorCheck("relay-build", "relay build")
  if (!options.relayResult.ok) {
    return check("warn", "relay unreachable; cannot compare builds")
  }
  const relayBuildId = options.relayResult.value.buildId
  if (!relayBuildId) {
    return check("warn", "running relay does not report a build id")
  }
  const matches = relayBuildId === options.cliBuildId
  return check(
    matches ? "ok" : "warn",
    matches
      ? `matches CLI build (${options.cliBuildId})`
      : `runtime ${relayBuildId} does not match CLI ${options.cliBuildId}`,
  )
}

function extensionVersionCheck(options: {
  readonly extensionResult: ProbeResult<ExtensionStatus>
  readonly bundledManifestVersion: ProbeResult<string>
}): DoctorCheck {
  const check = makeDoctorCheck("extension-version", "extension version")
  if (!options.extensionResult.ok) {
    return check("warn", options.extensionResult.error)
  }
  if (!options.extensionResult.value.connected) {
    return check("warn", "extension disconnected; cannot compare runtime version")
  }
  if (!options.bundledManifestVersion.ok) {
    return check("warn", `could not read ${bundledExtensionManifestPath}: ${options.bundledManifestVersion.error}`)
  }
  const runtimeVersion = options.extensionResult.value.version
  if (!runtimeVersion) {
    return check("warn", "extension did not report a version")
  }
  return check(
    "ok",
    runtimeVersion === options.bundledManifestVersion.value
      ? `matches bundled extension (${options.bundledManifestVersion.value})`
      : `runtime ${runtimeVersion} differs from bundled ${options.bundledManifestVersion.value}; protocol compatibility determines support`,
  )
}

export function extensionProtocolCheck(extensionResult: ProbeResult<ExtensionStatus>): DoctorCheck {
  const check = makeDoctorCheck("extension-protocol", "extension protocol")
  if (!extensionResult.ok) {
    return check("warn", extensionResult.error)
  }
  const protocolVersion = extensionResult.value.protocolVersion
  const protocolCompatible = extensionResult.value.protocolCompatible
  if (protocolCompatible === false) {
    return check("fail", `runtime ${protocolVersion ?? "unknown"} is incompatible with relay ${extensionProtocolVersion}`)
  }
  if (extensionResult.value.protocolLegacy === true) {
    return check("warn", `legacy extension does not report its protocol; relay infers ${protocolVersion ?? "unknown"}`)
  }
  if (protocolVersion === undefined || protocolVersion === null) {
    return check("warn", "extension protocol is unknown")
  }
  return check("ok", `runtime ${protocolVersion} is compatible with relay ${extensionProtocolVersion}`)
}

function buildDoctorRecommendations(options: {
  readonly relayResult: ProbeResult<RelayVersion>
  readonly extensionResult: ProbeResult<ExtensionStatus>
  readonly artifacts: readonly DoctorArtifact[]
  readonly staleCurrent: boolean
  readonly current: string | null
  readonly unhealthyTargets: readonly TargetSummary[]
}): readonly string[] {
  const relayRecommendations = options.relayResult.ok ? [] : [
    "Run a relay-backed command to start the detached relay automatically; use `opencode-browser serve` only for foreground debugging.",
  ]
  const relayBuildRecommendations = options.relayResult.ok
    ? [relayBuildProblem(options.relayResult.value)].filter((message) => message !== undefined)
    : []
  const extensionRecommendations = options.relayResult.ok && options.extensionResult.ok && !options.extensionResult.value.connected
    ? options.extensionResult.value.protocolCompatible === false
      ? ["Update the OpenCode Browser extension or npm package so their extension protocols are compatible."]
      : ["Run `npx opencode-browser-cli install`, and install OpenCode Browser from the Chrome Web Store (or load the unpacked extension it copies)."]
    : []
  const artifactRecommendations = options.artifacts.some((artifact) => {
    return !artifact.exists
  }) ? ["Prepare and select a fresh validated runtime with `pnpm runtime:prepare` / `pnpm runtime:select`; do not rebuild the active installation."] : []
  const connectionConflictRecommendations = options.extensionResult.ok && (options.extensionResult.value.rejectedConnections ?? 0) > 0
    ? ["Keep OpenCode Browser enabled in one browser/profile. To switch, disable it in the current browser before connecting the other; new sessions do not change the active browser."]
    : []
  const staleSessionRecommendations = options.staleCurrent && options.current ? [
    `Current session ${options.current} is stale; run \`opencode-browser session new\` or \`opencode-browser session use <id>\` after the relay is running.`,
  ] : []
  const unhealthyTargetRecommendations = options.unhealthyTargets.length ? [
    "A target is crashed or showing a browser error page. Run the owning session once to trigger relay-owned recovery, or reset/re-adopt a user-owned tab.",
  ] : []
  return [
    ...relayRecommendations,
    ...relayBuildRecommendations,
    ...extensionRecommendations,
    ...connectionConflictRecommendations,
    ...artifactRecommendations,
    ...staleSessionRecommendations,
    ...unhealthyTargetRecommendations,
  ]
}

function summarizeCheckStatus(checks: readonly DoctorCheck[]): DoctorCheckStatus {
  if (checks.some((check) => {
    return check.status === "fail"
  })) {
    return "fail"
  }
  if (checks.some((check) => {
    return check.status === "warn"
  })) {
    return "warn"
  }
  return "ok"
}

export function formatDoctorReport(report: DoctorReport): string {
  const lines: string[] = [
    "OpenCode Browser doctor",
    `Status: ${report.status}`,
    `Endpoint: ${report.endpoint}`,
    `CLI: ${report.cli.version} (${report.cli.buildId})`,
    `Package: ${report.package.name && report.package.version ? `${report.package.name} ${report.package.version}` : report.package.error ?? "unknown"}`,
    `Relay: ${report.relay.reachable ? `reachable (${report.relay.version ?? "unknown"}, ${report.relay.buildId ?? "unknown build"})` : `unreachable (${report.relay.error ?? "unknown error"})`}`,
    `Extension: ${formatExtensionSummary(report)}`,
    `Targets: active=${formatNullableNumber(report.targets.active)} child=${formatNullableNumber(report.targets.child)} relay-owned=${report.targets.relayOwned.length} unhealthy=${report.targets.unhealthy.length}`,
    `Sessions: current=${report.sessions.current ?? "none"} total=${report.sessions.all.length} connected=${report.sessions.all.filter((session) => {
      return session.connected
    }).length}`,
    "",
    "Checks:",
    ...report.checks.map((check) => {
      return `[${check.status}] ${check.label}: ${check.message}`
    }),
  ]
  const targetLines = report.targets.relayOwned.map((target) => {
    return `- ${formatTargetSummary(target)}`
  })
  const unhealthyTargetLines = report.targets.unhealthy.map((target) => {
    return `- ${formatTargetSummary(target)}`
  })
  const sessionLines = report.sessions.possibleLeaked.map((session) => {
    return `- ${session.id} ${session.pageUrl ?? "no page yet"}`
  })
  const details = [
    ...(targetLines.length ? ["", "Relay-owned targets:", ...targetLines] : []),
    ...(unhealthyTargetLines.length ? ["", "Unhealthy targets:", ...unhealthyTargetLines] : []),
    ...(sessionLines.length ? ["", "Connected non-current sessions:", ...sessionLines] : []),
    ...(report.recommendations.length ? ["", "Next steps:", ...report.recommendations.map((item) => {
      return `- ${item}`
    })] : []),
  ]
  return [...lines, ...details].join("\n")
}

function formatExtensionSummary(report: DoctorReport): string {
  if (report.extension.connected === null) {
    return `unknown (${report.extension.error ?? "relay unreachable"})`
  }
  const version = report.extension.version ? ` (${report.extension.version})` : ""
  const protocol = report.extension.protocolVersion === null
    ? ""
    : `, protocol ${report.extension.protocolVersion} ${report.extension.protocolCompatible === false ? "incompatible" : "compatible"}`
  const match = report.extension.versionMatches === null ? "" : report.extension.versionMatches ? ", matches bundled version" : ", differs from bundled version"
  return `${report.extension.connected ? "connected" : "disconnected"}${version}${protocol}${match}`
}

function formatNullableNumber(value: number | null): string {
  return value === null ? "unknown" : String(value)
}

export function formatTargetSummary(target: TargetSummary, options: { readonly includeSession?: boolean } = {}): string {
  const tab = target.tabId === undefined ? "" : ` tab=${target.tabId}`
  const session = options.includeSession && target.opencodeBrowserSessionId ? ` session=${target.opencodeBrowserSessionId}` : ""
  const owner = target.owner ? ` owner=${target.owner}` : ""
  const health = `${target.crashed ? " crashed=true" : ""}${target.protectedUi ? " protected-ui=true" : ""}`
  return `${target.type} ${target.id}${tab}${session}${owner}${health} ${target.url || "about:blank"}`
}
