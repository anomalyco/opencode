#!/usr/bin/env node
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { Config, Console, Effect, FileSystem, Layer, Option, Predicate, Result, Schema } from "effect"
import { Argument, Command, Flag } from "effect/cli"
import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"
import { createDoctorReport, formatDoctorReport, formatTargetSummary } from "./doctor.ts"
import { runMcpServer } from "./mcp.ts"
import * as RelayClient from "./relay-client.ts"
import { parseAdditionalExtensionOrigins } from "./relay-helpers.ts"
import * as RelayLifecycle from "./relay-lifecycle.ts"
import type { ExecuteAftermath, ExecuteLogEntry, ExecuteResponse, NetworkStatusResponse, NetworkStopResponse, RecordingQuality } from "./relay-schema.ts"
import { startRelay } from "./relay.ts"
import { defaultJournalBaseDir, formatJournalEntry, readJournalEntries } from "./session-journal.ts"
import * as SessionStore from "./session-store.ts"
import { opencodeBrowserVersion } from "./version.ts"

const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const sessionIdConfig = Config.option(Config.String("OPENCODE_BROWSER_SESSION"))
const targetUrlConfig = Config.option(Config.String("OPENCODE_BROWSER_TARGET_URL"))
const targetIndexConfig = Config.option(Config.Int("OPENCODE_BROWSER_TARGET_INDEX"))
const encodedCliOperandsMarker = "bc-cli-operands:v1"
const encodedCliOperandPrefix = "bc-cli-operand:"
const jsonFlag = Flag.Boolean("json").pipe(Flag.withDefault(false), Flag.withDescription("Print machine-readable JSON"))
const sessionFlag = (description?: string) => {
  const flag = Flag.String("session").pipe(Flag.optional, Flag.withAlias("s"))
  return description ? flag.pipe(Flag.withDescription(description)) : flag
}
const tabIdFlag = (description?: string) => {
  const flag = Flag.Int("tab-id").pipe(Flag.optional)
  return description ? flag.pipe(Flag.withDescription(description)) : flag
}
const failExit = Effect.sync(() => {
  process.exitCode = 1
})

export function resolveExplicitSessionSelector(options: {
  readonly positional: string | undefined
  readonly flag: string | undefined
  readonly environment: string | undefined
}): string | undefined {
  if (options.positional && options.flag) {
    throw new Error("Use either a positional session id or --session, not both")
  }
  return options.flag ?? options.positional ?? options.environment
}

export function formatRecordingQuality(quality: RecordingQuality | undefined): string {
  if (!quality) return "Capture quality: unavailable (tab capture or older relay)."
  return [
    `Capture: ${quality.width}×${quality.height}, output ${quality.frameRate} fps; source surface ${quality.sourceWidth ?? "?"}×${quality.sourceHeight ?? "?"} CSS px`,
    `Source frames: ${quality.sourceFrameCount} received (${quality.achievedSourceFrameRate.toFixed(1)}/s), ${quality.encodedSourceFrameCount} retained (${quality.achievedEncodedSourceFrameRate.toFixed(1)}/s), ${quality.coalescedFrameCount} coalesced, ${quality.droppedFrameCount} dropped`,
    quality.screenshotFallback
      ? "WARNING: no compositor frames arrived; this video holds a single stop-time screenshot."
      : "Source counts are compositor events, not a measurement of distinct motion. Inspect the video before sharing.",
  ].join("\n")
}

export function normalizeCliArguments(args: ReadonlyArray<string>): ReadonlyArray<string> {
  const delimiter = args.indexOf("--")
  const secretsRun = args.findIndex((argument, index) => argument === "secrets" && args[index + 1] === "run")
  if (delimiter === -1 || secretsRun === -1 || secretsRun > delimiter) return args
  return [
    ...args.slice(0, delimiter),
    encodedCliOperandsMarker,
    ...args.slice(delimiter + 1).map((operand) => `${encodedCliOperandPrefix}${encodeURIComponent(operand)}`),
  ]
}

function decodeCliOperands(operands: ReadonlyArray<string>): ReadonlyArray<string> {
  if (operands[0] !== encodedCliOperandsMarker) return operands
  return operands.slice(1).map((operand) => {
    if (!operand.startsWith(encodedCliOperandPrefix)) throw new Error("Invalid encoded secrets run operand")
    return decodeURIComponent(operand.slice(encodedCliOperandPrefix.length))
  })
}

const readExecuteFile = Effect.fnUntraced(function* (filePath: string) {
  const fs = yield* FileSystem.FileSystem
  return yield* fs.readFileString(path.resolve(filePath)).pipe(
    Effect.mapError((cause) => new Error(`read execute file ${filePath}: ${cause.reason.message}`, { cause })),
  )
})

const ensureCliRelay = Effect.fnUntraced(function* () {
  const relay = yield* RelayClient.Service
  const readiness = yield* RelayLifecycle.ensureRelay({ relay })
  if (readiness.started) {
    yield* Console.error(`Started OpenCode Browser relay at ${relay.endpoint}`)
  }
  if (readiness.buildProblem) {
    return yield* Effect.fail(new Error(readiness.buildProblem))
  }
  return readiness
})

const ensureCliRelayAndExtension = Effect.fnUntraced(function* () {
  const relay = yield* RelayClient.Service
  const readiness = yield* ensureCliRelay()
  yield* RelayLifecycle.ensureExtensionConnected({
    relay,
    waitForReconnect: RelayLifecycle.shouldWaitForExtensionReconnect(readiness),
    onWait: Console.error(`Waiting up to ${RelayLifecycle.extensionReconnectWaitMs / 1_000}s for the OpenCode Browser extension to reconnect`),
  })
})

const resolveSelectedSessionId = Effect.fnUntraced(function* (explicitSessionId: string | undefined) {
  const store = yield* SessionStore.Service
  const sessionId = explicitSessionId ?? (yield* store.read)
  if (!sessionId) {
    return yield* Effect.fail(new Error("No session provided and no current OpenCode Browser session exists"))
  }
  return sessionId
})

const resolvePositionalOrFlagSessionId = Effect.fnUntraced(function* (
  id: Option.Option<string>,
  session: Option.Option<string>,
) {
  return yield* resolveSelectedSessionId(resolveExplicitSessionSelector({
    positional: Option.getOrUndefined(id),
    flag: Option.getOrUndefined(session),
    environment: Option.getOrUndefined(yield* sessionIdConfig),
  }))
})

const ensureSessionExists = Effect.fnUntraced(function* (id: string) {
  const relay = yield* RelayClient.Service
  yield* ensureCliRelay()
  const sessions = yield* relay.sessions
  const exists = sessions.some((session) => {
    return session.id === id
  })
  if (!exists) {
    return yield* Effect.fail(new Error(`Session not found: ${id}`))
  }
})

const recordingTarget = Effect.fnUntraced(function* (options: {
  readonly session: Option.Option<string>
  readonly tabId: Option.Option<number>
}) {
  const sessionId = Option.getOrUndefined(options.session)
  const tabId = Option.getOrUndefined(options.tabId)
  if (sessionId && tabId !== undefined) {
    return yield* Effect.fail(new Error("Use only one recording target selector: --session or --tab-id"))
  }
  return {
    ...(sessionId ? { sessionId } : {}),
    ...(tabId === undefined ? {} : { tabId }),
  }
})

const parseRecordingModeOption = Effect.fnUntraced(function* (value: string | undefined) {
  if (value === undefined) {
    return undefined
  }
  if (value === "auto" || value === "tab-capture" || value === "cdp") {
    return value
  }
  return yield* Effect.fail(new Error("Recording mode must be auto, tab-capture, or cdp"))
})

function formatExecuteLogs(logs: readonly ExecuteLogEntry[]): string {
  return [
    "Console logs:",
    ...logs.map((log) => {
      const location = log.location?.url ? ` ${log.location.url}:${log.location.lineNumber}:${log.location.columnNumber}` : ""
      return `[${log.source}:${log.type}]${location} ${log.text}`
    }),
  ].join("\n")
}

/** One-line aftermath summary, or null when nothing interesting happened. */
function formatAftermath(aftermath: ExecuteAftermath): string | null {
  const parts: string[] = []
  if (aftermath.startUrl !== aftermath.endUrl) {
    parts.push(`Page: ${aftermath.startUrl ?? "none"} -> ${aftermath.endUrl ?? "none"}`)
  }
  if (aftermath.navigations.length > 1) {
    parts.push(`navigations=${aftermath.navigations.length}`)
  }
  if (aftermath.pageErrorCount > 0) {
    parts.push(`pageErrors=${aftermath.pageErrorCount}`)
  }
  if (aftermath.handoffs > 0) {
    parts.push(`handoffs=${aftermath.handoffs}`)
  }
  return parts.length > 0 ? parts.join(" ") : null
}

type ExecuteJsonEnvelope = {
  readonly ok: boolean
  readonly isError: boolean
  readonly text: string
  readonly value: unknown | null
  readonly valueUnavailable: boolean
  readonly error?: { readonly _tag: string; readonly message: string }
  readonly logs: readonly ExecuteLogEntry[]
  readonly warnings: readonly string[]
  readonly diagnostic?: string
  readonly aftermath?: ExecuteAftermath
  readonly session?: ExecuteResponse["session"]
}

const ScriptErrorEnvelope = Schema.TaggedStruct("ScriptError", {
  message: Schema.String,
})

export function executeJsonEnvelope(result: ExecuteResponse): ExecuteJsonEnvelope {
  const hasStructuredValue = Object.hasOwn(result, "value") && result.value !== undefined
  return {
    ok: !result.isError,
    isError: result.isError,
    text: result.text,
    value: hasStructuredValue ? result.value : null,
    valueUnavailable: !hasStructuredValue,
    ...(result.isError ? { error: ScriptErrorEnvelope.make({ message: result.text }) } : {}),
    logs: result.logs,
    warnings: result.warnings ?? [],
    ...(result.diagnostic ? { diagnostic: result.diagnostic } : {}),
    ...(result.aftermath ? { aftermath: result.aftermath } : {}),
    session: result.session,
  }
}

export function formatSessionContinuation(sessionId: string): string {
  return `Session: ${sessionId}. Continue with --session ${sessionId}.`
}

function errorJsonEnvelope(error: unknown): ExecuteJsonEnvelope {
  const tag = Predicate.isObject(error) && Predicate.hasProperty(error, "_tag") && Predicate.isString(error._tag) ? error._tag : "Error"
  const message = error instanceof Error ? error.message : String(error)
  const errorValue: { readonly _tag: string; readonly message: string } = Object.assign({ message }, { _tag: tag })
  return { ok: false, isError: true, text: message, value: null, valueUnavailable: true, error: errorValue, logs: [], warnings: [] }
}

const serve = Command.make(
  "serve",
  {},
  Effect.fn("Cli.serve")(function* () {
    const port = yield* RelayClient.portConfig
    const additionalExtensionOrigins = parseAdditionalExtensionOrigins(yield* RelayClient.extensionOriginsConfig)
    yield* Effect.scoped(
      Effect.gen(function* () {
        const relay = yield* startRelay({ port, additionalExtensionOrigins })
        yield* Console.log(`opencode-browser relay listening at ${relay.url}`)
        yield* Console.log("OpenCode Browser connects automatically while the browser runs. Run `opencode-browser status` to check.")
        yield* Effect.never
      }),
    )
  }),
).pipe(Command.withDescription("Start the local OpenCode Browser relay"))

const relayRestart = Command.make(
  "restart",
  {},
  Effect.fn("Cli.relayRestart")(function* () {
    const relay = yield* RelayClient.Service
    yield* Console.error("Restarting the relay leaves browser tabs open but resets in-memory JavaScript state.")
    const readiness = yield* RelayLifecycle.restartRelay({ relay, clientKind: "cli" })
    yield* Console.log(`${readiness.started ? "Started" : "Reused concurrent replacement"} OpenCode Browser relay at ${relay.endpoint} (${readiness.version.buildId})`)
  }),
).pipe(Command.withDescription("Explicitly drain and restart the managed relay using this installation"))

const relay = Command.make("relay").pipe(
  Command.withDescription("Manage the local relay lifecycle"),
  Command.withSubcommands([relayRestart]),
)

const execute = Command.make(
  "execute",
  {
    code: Argument.String("code").pipe(Argument.variadic({ min: 0 })),
    file: Flag.String("file").pipe(Flag.optional, Flag.withDescription("Read execute code from a file")),
    session: sessionFlag("Continue an existing OpenCode Browser session; omit to create a fresh one"),
    targetUrl: Flag.String("target-url").pipe(Flag.optional, Flag.withDescription("Use the attached page whose URL contains this text")),
    targetIndex: Flag.Int("target-index").pipe(Flag.optional, Flag.withDescription("Use the attached page at this zero-based index")),
    json: Flag.Boolean("json").pipe(Flag.withDefault(false), Flag.withDescription("Print a machine-readable result envelope: { ok, isError, text, value, valueUnavailable, error?, logs, warnings, diagnostic?, aftermath, session }")),
  },
  Effect.fn("Cli.execute")(function* ({ code, file, session, targetUrl, targetIndex, json }) {
    const run = Effect.gen(function* () {
      const relay = yield* RelayClient.Service
      const filePath = Option.getOrUndefined(file)
      if (code.length > 0 && filePath) {
        return yield* Effect.fail(new Error("Use either positional code or --file, not both"))
      }
      if (code.length === 0 && !filePath) {
        return yield* Effect.fail(new Error("Execute requires positional code or --file <path>"))
      }
      const executeCode = filePath ? yield* readExecuteFile(filePath) : code.join(" ")
      yield* ensureCliRelayAndExtension()
      const explicitSessionId = Option.getOrUndefined(session) ?? Option.getOrUndefined(yield* sessionIdConfig)
      const targetUrlValue = Option.getOrUndefined(targetUrl) ?? Option.getOrUndefined(yield* targetUrlConfig)
      const targetIndexValue = Option.getOrUndefined(targetIndex) ?? Option.getOrUndefined(yield* targetIndexConfig)
      if (targetIndexValue !== undefined && targetIndexValue < 0) {
        return yield* Effect.fail(new Error("Target index must be a non-negative integer"))
      }
      if (targetUrlValue && targetIndexValue !== undefined) {
        return yield* Effect.fail(new Error("Use only one target selector: --target-url/OPENCODE_BROWSER_TARGET_URL or --target-index/OPENCODE_BROWSER_TARGET_INDEX"))
      }
      const result = yield* relay.execute({
        ...(explicitSessionId ? { sessionId: explicitSessionId } : {}),
        code: executeCode,
        createIfMissing: !explicitSessionId,
        ...(targetUrlValue || targetIndexValue !== undefined
          ? {
            targetSelection: {
              ...(targetUrlValue ? { urlIncludes: targetUrlValue } : {}),
              ...(targetIndexValue !== undefined ? { index: targetIndexValue } : {}),
            },
          }
          : {}),
      })
      if (!explicitSessionId) {
        yield* Console.error(formatSessionContinuation(result.session.id))
      }
      return result
    })
    if (json) {
      const envelope = yield* run.pipe(
        Effect.map(executeJsonEnvelope),
        Effect.catch((error) => Effect.succeed(errorJsonEnvelope(error))),
      )
      yield* Console.log(JSON.stringify(envelope, null, 2))
      if (!envelope.ok) {
        yield* failExit
      }
      return
    }
    const outcome = yield* Effect.result(run)
    if (Result.isFailure(outcome)) {
      yield* Console.error(outcome.failure.message)
      yield* failExit
      return
    }
    const result = outcome.success
    const print = result.isError ? Console.error : Console.log
    yield* print(result.text)
    if (result.logs.length > 0) {
      yield* print(formatExecuteLogs(result.logs))
    }
    yield* Effect.forEach(result.warnings ?? [], (warning) => print(`Warning: ${warning}`))
    if (result.diagnostic) {
      yield* print(`Diagnostic: ${result.diagnostic}`)
    }
    const aftermath = result.aftermath ? formatAftermath(result.aftermath) : null
    if (aftermath) {
      yield* print(aftermath)
    }
    if (result.isError) {
      yield* failExit
    }
  }),
).pipe(Command.withDescription("Execute Playwright code against the attached browser"))

const sessionNew = Command.make(
  "new",
  {
    name: Argument.String("name").pipe(Argument.optional, Argument.withDescription("Optional lowercase session id")),
    readOnly: Flag.Boolean("read-only").pipe(Flag.withDefault(false), Flag.withDescription("Create a read-only session: the relay rejects input-dispatching CDP so scripts can inspect but not click or type")),
  },
  Effect.fn("Cli.sessionNew")(function* ({ name, readOnly }) {
    const relay = yield* RelayClient.Service
    yield* ensureCliRelay()
    const store = yield* SessionStore.Service
    const result = yield* relay.sessionNew(Option.getOrUndefined(name), readOnly ? { readOnly: true } : {})
    yield* store.write(result.id)
    yield* Console.log(result.id)
  }),
).pipe(Command.withDescription("Create a OpenCode Browser session and make it current"))

const sessionList = Command.make(
  "list",
  {
    json: jsonFlag,
  },
  Effect.fn("Cli.sessionList")(function* ({ json }) {
    const relay = yield* RelayClient.Service
    yield* ensureCliRelay()
    const store = yield* SessionStore.Service
    const sessions = yield* relay.sessions
    const current = yield* store.read
    if (json) {
      yield* Console.log(JSON.stringify({ current: current ?? undefined, sessions }, null, 2))
      return
    }
    if (sessions.length === 0) {
      yield* Console.log("No sessions")
      return
    }
    yield* Effect.forEach(sessions, (item) => {
      const marker = item.id === current ? "*" : " "
      const page = item.pageUrl ?? "no page yet"
      const keys = item.stateKeys.length ? ` state=${item.stateKeys.join(",")}` : ""
      const readOnly = item.readOnly ? " read-only" : ""
      return Console.log(`${marker} ${item.id} ${page}${keys}${readOnly}`)
    })
  }),
).pipe(Command.withDescription("List OpenCode Browser sessions"))

const sessionCurrent = Command.make(
  "current",
  {},
  Effect.fn("Cli.sessionCurrent")(function* () {
    const store = yield* SessionStore.Service
    const current = yield* store.read
    yield* Console.log(current ?? "none")
  }),
).pipe(Command.withDescription("Print the current default session"))

const sessionUse = Command.make(
  "use",
  {
    id: Argument.String("id"),
  },
  Effect.fn("Cli.sessionUse")(function* ({ id }) {
    const store = yield* SessionStore.Service
    yield* ensureSessionExists(id)
    yield* store.write(id)
    yield* Console.log(id)
  }),
).pipe(Command.withDescription("Set the current default session"))

const sessionReset = Command.make(
  "reset",
  {
    id: Argument.String("id").pipe(Argument.optional),
    session: sessionFlag("Reset this OpenCode Browser session id"),
  },
  Effect.fn("Cli.sessionReset")(function* ({ id, session }) {
    const relay = yield* RelayClient.Service
    const sessionId = yield* resolvePositionalOrFlagSessionId(id, session)
    yield* ensureCliRelay()
    const resetSession = yield* relay.sessionReset(sessionId)
    yield* Console.log(resetSession.id)
  }),
).pipe(Command.withDescription("Reset a OpenCode Browser session state and page"))

const sessionAdopt = Command.make(
  "adopt",
  {
    session: sessionFlag("Adopt into this OpenCode Browser session, creating it when it does not exist yet; omit to create a fresh readable id"),
    targetUrl: Flag.String("target-url").pipe(Flag.optional, Flag.withDescription("Adopt the attached page whose URL contains this text")),
    targetIndex: Flag.Int("target-index").pipe(Flag.optional, Flag.withDescription("Adopt the attached page at this zero-based target index")),
    tabId: tabIdFlag("Adopt the user's shared tab with this Chrome tab id (the tab= value in status)"),
  },
  Effect.fn("Cli.sessionAdopt")(function* ({ session, targetUrl, targetIndex, tabId }) {
    const relay = yield* RelayClient.Service
    yield* ensureCliRelayAndExtension()
    const explicitSessionId = Option.getOrUndefined(session) ?? Option.getOrUndefined(yield* sessionIdConfig)
    const targetUrlValue = Option.getOrUndefined(targetUrl)
    const targetIndexValue = Option.getOrUndefined(targetIndex)
    if (targetIndexValue !== undefined && targetIndexValue < 0) {
      return yield* Effect.fail(new Error("Target index must be a non-negative integer"))
    }
    const tabIdValue = Option.getOrUndefined(tabId)
    if ([targetUrlValue, targetIndexValue, tabIdValue].filter((value) => value !== undefined).length > 1) {
      return yield* Effect.fail(new Error("Use only one target selector: --target-url, --target-index, or --tab-id"))
    }
    const targetSelection = targetUrlValue
      ? { urlIncludes: targetUrlValue }
      : targetIndexValue !== undefined
      ? { index: targetIndexValue }
      : undefined
    // An explicit id names the session the agent wants to continue with; creating it here
    // mirrors `session new <id>` and never infers identity from shared current-session state.
    const result = yield* relay.sessionAdopt({
      ...(explicitSessionId ? { sessionId: explicitSessionId } : {}),
      createIfMissing: true,
      ...(targetSelection ? { targetSelection } : {}),
      ...(tabIdValue === undefined ? {} : { tabId: tabIdValue }),
    })
    yield* Console.log(`${result.session.created ? "Created and adopted" : "Adopted"} session '${result.session.id}' default page: ${result.adoptedUrl}`)
    if (result.session.created) {
      yield* Console.error(formatSessionContinuation(result.session.id))
    }
  }),
).pipe(Command.withDescription("Make an attached tab the session's default page"))

const sessionDelete = Command.make(
  "delete",
  {
    id: Argument.String("id").pipe(Argument.optional),
    session: sessionFlag("Delete this OpenCode Browser session id"),
  },
  Effect.fn("Cli.sessionDelete")(function* ({ id, session }) {
    const relay = yield* RelayClient.Service
    const store = yield* SessionStore.Service
    const sessionId = yield* resolvePositionalOrFlagSessionId(id, session)
    yield* ensureCliRelay()
    yield* relay.sessionDelete(sessionId)
    const current = yield* store.read
    if (current === sessionId) {
      yield* store.clear
    }
    yield* Console.log(sessionId)
  }),
).pipe(Command.withDescription("Delete a OpenCode Browser session"))

const session = Command.make("session").pipe(
  Command.withDescription("Manage OpenCode Browser sessions"),
  Command.withSubcommands([sessionNew, sessionList, sessionCurrent, sessionUse, sessionReset, sessionAdopt, sessionDelete]),
)

const status = Command.make(
  "status",
  {
    json: jsonFlag,
  },
  Effect.fn("Cli.status")(function* ({ json }) {
    const relay = yield* RelayClient.Service
    const store = yield* SessionStore.Service
    const relayResult = yield* Effect.result(relay.version)
    if (Result.isFailure(relayResult)) {
      if (!(relayResult.failure instanceof RelayClient.RelayUnreachable)) {
        if (json) {
          yield* Console.log(JSON.stringify({
            endpoint: relay.endpoint,
            relay: { running: false, error: relayResult.failure.message },
            extension: null,
            sessions: [],
            targets: [],
          }, null, 2))
        } else {
          yield* Console.error(`Relay status failed: ${relayResult.failure.message}`)
        }
        yield* failExit
        return
      }
      const stopped = RelayLifecycle.stoppedRelayStatus(relay.endpoint)
      if (json) {
        yield* Console.log(JSON.stringify(stopped, null, 2))
      } else {
        yield* Console.log(`Relay: stopped (${relay.endpoint})`)
        yield* Console.log("Run opencode-browser execute to start it automatically.")
      }
      yield* failExit
      return
    }
    const version = relayResult.success
    const buildProblem = RelayLifecycle.relayBuildProblem(version)
    const [extensionStatus, current] = yield* Effect.all([relay.extensionStatus, store.read])
    const collections = RelayLifecycle.statusCollections(extensionStatus)
    const [sessions, targets] = collections
      ? [collections.sessions, collections.targets]
      : yield* Effect.all([relay.sessions, relay.targets])
    if (json) {
      yield* Console.log(JSON.stringify({
        endpoint: relay.endpoint,
        relay: { running: true, version: version.version, buildId: version.buildId ?? null, stale: buildProblem !== undefined },
        extension: extensionStatus,
        currentSession: current ?? null,
        sessions,
        targets,
      }, null, 2))
      if (buildProblem) {
        yield* failExit
      }
      return
    }
    yield* Console.log(`Relay: ${relay.endpoint} (${version.version})`)
    if (buildProblem) {
      yield* Console.log(`Warning: ${buildProblem}`)
    }
    yield* Console.log(`Extension: ${extensionStatus.connected ? "connected" : "disconnected"}${extensionStatus.version ? ` (${extensionStatus.version})` : ""}`)
    if ((extensionStatus.rejectedConnections ?? 0) > 0) {
      yield* Console.log(`Warning: ${extensionStatus.rejectedConnections} competing browser/profile connection attempt(s) rejected; the active connection was preserved. Use OpenCode Browser in one browser/profile at a time.`)
    }
    if (extensionStatus.protocolVersion !== undefined && extensionStatus.protocolVersion !== null) {
      const compatibility = extensionStatus.protocolCompatible === false ? "incompatible" : "compatible"
      const legacy = extensionStatus.protocolLegacy === true ? ", inferred from legacy hello" : ""
      yield* Console.log(`Extension protocol: ${extensionStatus.protocolVersion} (${compatibility}${legacy})`)
    }
    yield* Console.log(`Active targets: ${extensionStatus.activeTargets}`)
    if (extensionStatus.childTargets !== undefined) {
      yield* Console.log(`Child targets: ${extensionStatus.childTargets}`)
    }
    if (extensionStatus.cdpClients !== undefined) {
      yield* Console.log(`CDP clients: ${extensionStatus.cdpClients}`)
    }
    yield* Console.log(`Current session: ${current ?? "none"}`)
    if (sessions.length === 0) {
      yield* Console.log("Sessions: none")
    } else {
      yield* Console.log("Sessions:")
      const activeSessions = sessions.filter((item) => item.id === current || item.connected || item.pageUrl !== null || item.stateKeys.length > 0 || item.readOnly)
      const idleSessions = sessions.filter((item) => !activeSessions.includes(item))
      const shownSessions = activeSessions.length > 0 ? activeSessions : idleSessions.slice(0, 5)
      const omittedIdleCount = activeSessions.length > 0 ? idleSessions.length : Math.max(0, idleSessions.length - shownSessions.length)
      yield* Effect.forEach(shownSessions, (item) => {
        const marker = item.id === current ? "*" : " "
        return Console.log(`${marker} ${item.id} ${item.pageUrl ?? "no page yet"}`)
      })
      if (omittedIdleCount > 0) {
        yield* Console.log(`  (${omittedIdleCount} idle session(s) with no page omitted; run opencode-browser session list to view all)`)
      }
    }
    if (targets.length === 0) {
      yield* Console.log("Targets: none")
    } else {
      yield* Console.log("Targets:")
      yield* Effect.forEach(targets, (target, index) => {
        return Console.log(`- [${index}] ${formatTargetSummary(target, { includeSession: true })}`)
      })
    }
    if (buildProblem) {
      yield* failExit
    }
  }),
).pipe(Command.withDescription("Show relay, extension, and target status"))

const recordingStart = Command.make(
  "start",
  {
    outputPath: Argument.String("output-path").pipe(Argument.withDescription("Path to write the recording artifact; tabCapture requires .webm, CDP accepts .webm or .mp4")),
    session: sessionFlag("Record the page for this OpenCode Browser or CDP session id"),
    tabId: tabIdFlag("Record this attached Chrome tab id"),
    mode: Flag.String("mode").pipe(Flag.optional, Flag.withDescription("Recording mode: auto, tab-capture, or cdp. auto uses CDP for relay-owned tabs and tabCapture for user-owned tabs")),
    audio: Flag.Boolean("audio").pipe(Flag.withDefault(false), Flag.withDescription("Include tab audio")),
    frameRate: Flag.Int("frame-rate").pipe(Flag.optional, Flag.withDescription("Output frame rate, integer 1..60; defaults to 30 for tab-capture and 60 for CDP")),
    maxDurationMs: Flag.Int("max-duration-ms").pipe(Flag.optional, Flag.withDescription("Auto-stop guard in milliseconds, defaults to 900000")),
    json: jsonFlag,
  },
  Effect.fn("Cli.recordingStart")(function* ({ outputPath, session, tabId, mode, audio, frameRate, maxDurationMs, json }) {
    if (Option.isSome(frameRate) && (frameRate.value < 1 || frameRate.value > 60)) {
      return yield* Effect.fail(new Error("Recording frameRate must be an integer from 1 to 60"))
    }
    const relay = yield* RelayClient.Service
    yield* ensureCliRelayAndExtension()
    const target = yield* recordingTarget({ session, tabId })
    const modeValue = yield* parseRecordingModeOption(Option.getOrUndefined(mode))
    const resolvedOutputPath = path.resolve(outputPath)
    const result = yield* relay.recordingStart({
      ...target,
      outputPath: resolvedOutputPath,
      ...(modeValue === undefined ? {} : { mode: modeValue }),
      audio,
      ...(Option.isSome(frameRate) ? { frameRate: frameRate.value } : {}),
      ...(Option.isSome(maxDurationMs) ? { maxDurationMs: maxDurationMs.value } : {}),
    })
    if (!result.success) {
      return yield* Effect.fail(new Error(result.error ?? "Failed to start recording"))
    }
    yield* Console.log(json ? JSON.stringify(result, null, 2) : `Recording started: ${result.path ?? resolvedOutputPath} tab=${result.tabId ?? "unknown"} mode=${result.mode ?? "tab-capture"} artifact=${result.artifactType ?? "webm"} mime=${result.mimeType ?? "video/webm"} fps=${result.frameRate ?? "unknown"}`)
  }),
).pipe(Command.withDescription("Start recording an attached tab"))

const recordingStop = Command.make(
  "stop",
  {
    session: sessionFlag("Stop recording for this CDP session id"),
    tabId: tabIdFlag("Stop recording for this Chrome tab id"),
    json: jsonFlag,
  },
  Effect.fn("Cli.recordingStop")(function* ({ session, tabId, json }) {
    const relay = yield* RelayClient.Service
    yield* ensureCliRelay()
    const target = yield* recordingTarget({ session, tabId })
    const result = yield* relay.recordingStop(target)
    if (!result.success) {
      return yield* Effect.fail(new Error(result.error ?? "Failed to stop recording"))
    }
    if (json) return yield* Console.log(JSON.stringify(result, null, 2))
    const frames = result.frameCount === undefined ? "" : `, frames=${result.frameCount}`
    yield* Console.log(`Recording saved: ${result.path ?? "unknown"} (${result.size ?? 0} bytes, ${result.duration ?? 0}ms, mode=${result.mode ?? "tab-capture"}, artifact=${result.artifactType ?? "webm"}${frames})`)
    yield* Console.log(formatRecordingQuality(result.quality))
  }),
).pipe(Command.withDescription("Stop recording and write the artifact"))

const recordingStatus = Command.make(
  "status",
  {
    session: sessionFlag("Check recording for this CDP session id"),
    tabId: tabIdFlag("Check recording for this Chrome tab id"),
    json: jsonFlag,
  },
  Effect.fn("Cli.recordingStatus")(function* ({ session, tabId, json }) {
    const relay = yield* RelayClient.Service
    yield* ensureCliRelay()
    const target = yield* recordingTarget({ session, tabId })
    const result = yield* relay.recordingStatus(target)
    if (json) {
      yield* Console.log(JSON.stringify(result, null, 2))
      return
    }
    if (!result.isRecording) {
      yield* Console.log("Recording: inactive")
      return
    }
    const frames = result.frameCount === undefined ? "" : ` frameCount=${result.frameCount}`
    yield* Console.log(`Recording: active tab=${result.tabId ?? "unknown"} mode=${result.mode ?? "tab-capture"} artifact=${result.artifactType ?? "webm"} path=${result.path ?? "unknown"} size=${result.size ?? 0}${frames} startedAt=${result.startedAt ?? "unknown"}`)
    yield* Console.log(formatRecordingQuality(result.quality))
  }),
).pipe(Command.withDescription("Check current recording status"))

const recordingCancel = Command.make(
  "cancel",
  {
    session: sessionFlag("Cancel recording for this CDP session id"),
    tabId: tabIdFlag("Cancel recording for this Chrome tab id"),
  },
  Effect.fn("Cli.recordingCancel")(function* ({ session, tabId }) {
    const relay = yield* RelayClient.Service
    yield* ensureCliRelay()
    const target = yield* recordingTarget({ session, tabId })
    const result = yield* relay.recordingCancel(target)
    if (!result.success) {
      return yield* Effect.fail(new Error(result.error ?? "Failed to cancel recording"))
    }
    yield* Console.log("Recording cancelled")
  }),
).pipe(Command.withDescription("Cancel recording without writing a file"))

const recording = Command.make("recording").pipe(
  Command.withDescription("Record an attached tab to WebM or MP4"),
  Command.withSubcommands([recordingStart, recordingStop, recordingStatus, recordingCancel]),
)

const flightRecorderStart = Command.make(
  "start",
  {
    session: sessionFlag("Buffer the tab owned by this session"),
    tabId: tabIdFlag("Buffer this attached Chrome tab id"),
    retentionMs: Flag.Int("retention-ms").pipe(Flag.optional, Flag.withDescription("Ring-buffer duration in milliseconds (1000..120000; default 60000)")),
    frameRate: Flag.Int("frame-rate").pipe(Flag.optional, Flag.withDescription("Output frame rate from 1 to 60")),
    json: jsonFlag,
  },
  Effect.fn("Cli.flightRecorderStart")(function* ({ session, tabId, retentionMs, frameRate, json }) {
    const relay = yield* RelayClient.Service
    yield* ensureCliRelayAndExtension()
    const target = yield* recordingTarget({ session, tabId })
    const result = yield* relay.flightRecorderStart({
      ...target,
      ...(Option.isSome(retentionMs) ? { retentionMs: retentionMs.value } : {}),
      ...(Option.isSome(frameRate) ? { frameRate: frameRate.value } : {}),
    })
    yield* Console.log(json ? JSON.stringify(result) : `Flight recorder buffering tab ${result.tabId}; retention=${result.retentionMs}ms`)
  }),
).pipe(Command.withDescription("Start a rolling in-memory video buffer"))

const flightRecorderStatus = Command.make(
  "status",
  {
    session: sessionFlag(),
    tabId: tabIdFlag(),
    json: jsonFlag,
  },
  Effect.fn("Cli.flightRecorderStatus")(function* ({ session, tabId, json }) {
    const relay = yield* RelayClient.Service
    yield* ensureCliRelay()
    const result = yield* relay.flightRecorderStatus(yield* recordingTarget({ session, tabId }))
    if (json) return yield* Console.log(JSON.stringify(result))
    if (!result.active) return yield* Console.log("Flight recorder inactive")
    yield* Console.log(`Flight recorder tab=${result.tabId} frames=${result.bufferedFrames} retained=${result.retainedDurationMs}ms bytes=${result.bufferedBytes}`)
  }),
).pipe(Command.withDescription("Show rolling flight-recorder status"))

const flightRecorderSaveLast = Command.make(
  "save-last",
  {
    outputPath: Argument.String("output-path").pipe(Argument.withDescription("Fresh .webm or .mp4 artifact path")),
    session: sessionFlag(),
    tabId: tabIdFlag(),
    durationMs: Flag.Int("duration-ms").pipe(Flag.optional, Flag.withDescription("How much recent history to save; defaults to 30 seconds")),
    json: jsonFlag,
  },
  Effect.fn("Cli.flightRecorderSaveLast")(function* ({ outputPath, session, tabId, durationMs, json }) {
    const relay = yield* RelayClient.Service
    yield* ensureCliRelay()
    const result = yield* relay.flightRecorderSaveLast({
      ...(yield* recordingTarget({ session, tabId })),
      outputPath: path.resolve(outputPath),
      ...(Option.isSome(durationMs) ? { durationMs: durationMs.value } : {}),
    })
    yield* Console.log(json ? JSON.stringify(result) : `Saved ${result.durationMs}ms flight recorder clip (${result.frameCount} frames) to ${result.path}`)
  }),
).pipe(Command.withDescription("Save the most recent buffered video without stopping the recorder"))

const flightRecorderCancel = Command.make(
  "cancel",
  {
    session: sessionFlag(),
    tabId: tabIdFlag(),
  },
  Effect.fn("Cli.flightRecorderCancel")(function* ({ session, tabId }) {
    const relay = yield* RelayClient.Service
    yield* ensureCliRelay()
    const result = yield* relay.flightRecorderCancel(yield* recordingTarget({ session, tabId }))
    yield* Console.log(result.cancelled ? "Flight recorder stopped" : "No active flight recorder")
  }),
).pipe(Command.withDescription("Stop and discard the rolling video buffer"))

const flightRecorder = Command.make("flight-recorder").pipe(
  Command.withDescription("Keep and save a rolling buffer of recent browser video"),
  Command.withSubcommands([flightRecorderStart, flightRecorderStatus, flightRecorderSaveLast, flightRecorderCancel]),
)

const networkSession = Effect.fnUntraced(function* (session: Option.Option<string>) {
  return yield* resolveSelectedSessionId(Option.getOrUndefined(session) ?? Option.getOrUndefined(yield* sessionIdConfig))
})

const parseNetworkContent = Effect.fnUntraced(function* (content: Option.Option<string>) {
  const value = Option.getOrUndefined(content)
  if (value === undefined || value === "embed" || value === "omit") return value
  return yield* Effect.fail(new Error("Network content must be embed or omit"))
})

function formatNetworkStatus(status: NetworkStatusResponse): string {
  if (!status.active) return "Network capture: inactive"
  return `Network capture: active entries=${status.entryCount} responses=${status.responseCount} failures=${status.failureCount} bodyBytes=${status.capturedBodyBytes} truncated=${status.truncatedBodyCount} dropped=${status.droppedEntryCount} startedAt=${status.startedAt ?? "unknown"}`
}

function formatNetworkResult(result: NetworkStopResponse): string {
  const output = result.outputPath ? ` output=${result.outputPath}` : ""
  const profile = result.authProfile ? ` secrets=${result.authProfile.name}(${result.authProfile.slotCount})` : ""
  return `Network capture stopped: entries=${result.entryCount} responses=${result.responseCount} failures=${result.failureCount} bodyBytes=${result.capturedBodyBytes} truncated=${result.truncatedBodyCount} dropped=${result.droppedEntryCount}${output}${profile}`
}

const networkStart = Command.make(
  "start",
  {
    session: sessionFlag("Capture the default page for this OpenCode Browser session"),
    urlFilter: Flag.String("url").pipe(Flag.optional, Flag.withDescription("Capture only requests whose URL contains this text")),
    resourceTypes: Flag.String("resource-type").pipe(Flag.atMost(50), Flag.withDescription("Capture this Playwright resource type; repeat for multiple types")),
    content: Flag.String("content").pipe(Flag.optional, Flag.withDescription("Response and request body mode: embed (default) or omit")),
    maxBodyBytes: Flag.Int("max-body-bytes").pipe(Flag.optional, Flag.withDescription("Maximum captured bytes per body, defaults to 1000000")),
    maxTotalBodyBytes: Flag.Int("max-total-body-bytes").pipe(Flag.optional, Flag.withDescription("Maximum captured body bytes for the whole capture, defaults to 25000000")),
    maxEntries: Flag.Int("max-entries").pipe(Flag.optional, Flag.withDescription("Maximum request entries, defaults to 1000")),
    json: jsonFlag,
  },
  Effect.fn("Cli.networkStart")(function* ({ session, urlFilter, resourceTypes, content, maxBodyBytes, maxTotalBodyBytes, maxEntries, json }) {
    const relay = yield* RelayClient.Service
    yield* ensureCliRelayAndExtension()
    const sessionId = yield* networkSession(session)
    const contentValue = yield* parseNetworkContent(content)
    const result = yield* relay.networkStart({
      sessionId,
      ...(Option.isSome(urlFilter) ? { urlFilter: urlFilter.value } : {}),
      ...(resourceTypes.length === 0 ? {} : { resourceTypes }),
      ...(contentValue === undefined ? {} : { content: contentValue }),
      ...(Option.isSome(maxBodyBytes) ? { maxBodyBytes: maxBodyBytes.value } : {}),
      ...(Option.isSome(maxTotalBodyBytes) ? { maxTotalBodyBytes: maxTotalBodyBytes.value } : {}),
      ...(Option.isSome(maxEntries) ? { maxEntries: maxEntries.value } : {}),
    })
    yield* Console.log(json ? JSON.stringify(result, null, 2) : formatNetworkStatus(result))
  }),
).pipe(Command.withDescription("Start session-scoped network capture"))

const networkStatus = Command.make(
  "status",
  {
    session: sessionFlag(),
    json: jsonFlag,
  },
  Effect.fn("Cli.networkStatus")(function* ({ session, json }) {
    const relay = yield* RelayClient.Service
    const sessionId = yield* networkSession(session)
    yield* ensureCliRelay()
    const result = yield* relay.networkStatus({ sessionId })
    yield* Console.log(json ? JSON.stringify(result, null, 2) : formatNetworkStatus(result))
  }),
).pipe(Command.withDescription("Show session-scoped network capture status"))

const networkStop = Command.make(
  "stop",
  {
    session: sessionFlag(),
    output: Flag.String("output").pipe(Flag.optional, Flag.withAlias("o"), Flag.withDescription("Write a credential-redacted HAR artifact to this path")),
    secrets: Flag.String("secrets").pipe(Flag.optional, Flag.withDescription("Store captured credentials under this reusable profile name")),
    json: jsonFlag,
  },
  Effect.fn("Cli.networkStop")(function* ({ session, output, secrets, json }) {
    const relay = yield* RelayClient.Service
    const outputValue = Option.getOrUndefined(output)
    const secretsValue = Option.getOrUndefined(secrets)
    if (!outputValue && !secretsValue) {
      return yield* Effect.fail(new Error("network stop requires --output, --secrets, or both"))
    }
    const sessionId = yield* networkSession(session)
    yield* ensureCliRelay()
    const result = yield* relay.networkStop({
      sessionId,
      ...(outputValue ? { outputPath: path.resolve(outputValue) } : {}),
      ...(secretsValue ? { secrets: secretsValue } : {}),
    })
    yield* Console.log(json ? JSON.stringify(result, null, 2) : formatNetworkResult(result))
  }),
).pipe(Command.withDescription("Stop capture and write a redacted artifact or reusable secret profile"))

const networkCancel = Command.make(
  "cancel",
  { session: sessionFlag() },
  Effect.fn("Cli.networkCancel")(function* ({ session }) {
    const relay = yield* RelayClient.Service
    const sessionId = yield* networkSession(session)
    yield* ensureCliRelay()
    const result = yield* relay.networkCancel({ sessionId })
    yield* Console.log(result.cancelled ? "Network capture cancelled" : "Network capture was not active")
  }),
).pipe(Command.withDescription("Cancel capture without writing an artifact"))

const network = Command.make("network").pipe(
  Command.withDescription("Capture authenticated network exchanges for direct client derivation"),
  Command.withSubcommands([networkStart, networkStatus, networkStop, networkCancel]),
)

const secretsStatus = Command.make(
  "status",
  {
    name: Argument.String("name"),
    json: jsonFlag,
  },
  Effect.fn("Cli.secretsStatus")(function* ({ name, json }) {
    const relay = yield* RelayClient.Service
    yield* ensureCliRelay()
    const result = yield* relay.authStatus({ name })
    if (json) {
      yield* Console.log(JSON.stringify(result, null, 2))
      return
    }
    yield* Console.log(`Secrets profile ${result.name}: slots=${result.slotCount} updatedAt=${result.updatedAt}`)
    yield* Effect.forEach(result.slots, (slot) => Console.log(`- ${slot.ref} sources=${slot.sources.join(",")} expired=${slot.expired}${slot.expiresAt ? ` expiresAt=${slot.expiresAt}` : ""}`))
  }),
).pipe(Command.withDescription("Show secret profile metadata without revealing values"))

const secretsRefresh = Command.make(
  "refresh",
  {
    name: Argument.String("name"),
    session: sessionFlag(),
    urlFilter: Flag.String("url").pipe(Flag.optional, Flag.withDescription("Observe credentials only on matching request URLs")),
    timeoutMs: Flag.Int("timeout-ms").pipe(Flag.optional, Flag.withDescription("Page reload timeout, defaults to 30000")),
    json: jsonFlag,
  },
  Effect.fn("Cli.secretsRefresh")(function* ({ name, session, urlFilter, timeoutMs, json }) {
    const relay = yield* RelayClient.Service
    yield* ensureCliRelayAndExtension()
    const sessionId = yield* networkSession(session)
    const result = yield* relay.authRefresh({
      sessionId,
      name,
      ...(Option.isSome(urlFilter) ? { urlFilter: urlFilter.value } : {}),
      ...(Option.isSome(timeoutMs) ? { timeoutMs: timeoutMs.value } : {}),
    })
    yield* Console.log(json ? JSON.stringify(result, null, 2) : `Secrets profile ${name} refreshed: observed=${result.observedSecretRefs.length} changed=${result.updatedSecretRefs.length}`)
  }),
).pipe(Command.withDescription("Reload a session page and refresh a profile while preserving stable references"))

const secretsRun = Command.make(
  "run",
  {
    name: Argument.String("name"),
    command: Argument.String("command").pipe(Argument.variadic({ min: 1 })),
    cwd: Flag.String("cwd").pipe(Flag.optional, Flag.withDescription("Child process working directory")),
    timeoutMs: Flag.Int("timeout-ms").pipe(Flag.optional, Flag.withDescription("Child timeout in milliseconds, defaults to 120000")),
  },
  Effect.fn("Cli.secretsRun")(function* ({ name, command, cwd, timeoutMs }) {
    const relay = yield* RelayClient.Service
    yield* ensureCliRelay()
    const [executable, ...args] = decodeCliOperands(command)
    if (!executable) return yield* Effect.fail(new Error("secrets run requires a command after --"))
    const result = yield* relay.authRun({
      name,
      command: executable,
      args,
      cwd: path.resolve(Option.getOrElse(cwd, () => process.cwd())),
      ...(Option.isSome(timeoutMs) ? { timeoutMs: timeoutMs.value } : {}),
    })
    yield* Effect.sync(() => {
      if (result.stdout) process.stdout.write(result.stdout)
      if (result.stderr) process.stderr.write(result.stderr)
      if (result.stdoutTruncated || result.stderrTruncated) process.stderr.write("\nOpenCode Browser truncated child output.\n")
      if (result.exitCode !== 0) process.exitCode = result.exitCode
    })
  }),
).pipe(Command.withDescription("Run a command with profile values injected as BC_SECRET_* environment variables"))

const secrets = Command.make("secrets").pipe(
  Command.withDescription("Inspect, refresh, and use captured credentials without revealing their values"),
  Command.withSubcommands([secretsStatus, secretsRefresh, secretsRun]),
)

const journal = Command.make(
  "journal",
  {
    session: sessionFlag("Show the journal for this OpenCode Browser session id"),
    limit: Flag.Int("limit").pipe(Flag.optional, Flag.withDescription("Number of most recent entries to show, defaults to 20")),
    json: jsonFlag,
  },
  Effect.fn("Cli.journal")(function* ({ session, limit, json }) {
    const sessionId = yield* networkSession(session)
    const entries = yield* Effect.tryPromise({
      try: () => readJournalEntries({ baseDir: defaultJournalBaseDir(), sessionId, limit: Option.getOrUndefined(limit) ?? 20 }),
      catch: (cause) => new Error(`read session journal for ${sessionId}`, { cause }),
    })
    if (json) {
      yield* Console.log(JSON.stringify({ session: sessionId, entries }, null, 2))
      return
    }
    if (entries.length === 0) {
      yield* Console.log(`No journal entries for session ${sessionId}`)
      return
    }
    yield* Console.log(`Journal for ${sessionId} (last ${entries.length}):`)
    yield* Effect.forEach(entries, (entry) => {
      return Console.log(formatJournalEntry(entry))
    })
  }),
).pipe(Command.withDescription("Show what agents did in a OpenCode Browser session"))

const doctor = Command.make(
  "doctor",
  {
    json: jsonFlag,
  },
  Effect.fn("Cli.doctor")(function* ({ json }) {
    const report = yield* createDoctorReport({ packageRoot })
    if (json) {
      yield* Console.log(JSON.stringify(report, null, 2))
    } else {
      yield* Console.log(formatDoctorReport(report))
    }
    if (report.status === "fail") {
      yield* failExit
    }
  }),
).pipe(Command.withDescription("Diagnose the local OpenCode Browser install and runtime"))

const skill = Command.make(
  "skill",
  {},
  Effect.fn("Cli.skill")(function* () {
    const fs = yield* FileSystem.FileSystem
    const text = yield* fs.readFileString(path.join(packageRoot, "skills", "browse", "SKILL.md")).pipe(
      Effect.mapError((cause) => new Error("read opencode-browser skill", { cause })),
    )
    yield* Console.log(text.trimEnd())
  }),
).pipe(Command.withDescription("Print the OpenCode Browser agent skill text"))

const tabsCleanup = Command.make(
  "cleanup",
  {
    idleMinutes: Flag.Int("idle-minutes").pipe(
      Flag.optional,
      Flag.withDescription("Close agent tabs idle at least this long; 0 closes every eligible agent tab (default: the extension's setting, 10)"),
    ),
    json: jsonFlag,
  },
  Effect.fn("Cli.tabsCleanup")(function* ({ idleMinutes, json }) {
    const relay = yield* RelayClient.Service
    yield* ensureCliRelay()
    const result = yield* relay.tabsCleanup(Option.getOrUndefined(idleMinutes))
    if (json) return yield* Console.log(JSON.stringify(result, null, 2))
    if (!result.closed.length) return yield* Console.log("No idle agent tabs to close.")
    for (const tab of result.closed) yield* Console.log(`Closed ${tab.title} (idle ${tab.idleMinutes}m)`)
  }),
).pipe(Command.withDescription("Close tabs agents opened that nobody has used for a while"))

const tabs = Command.make("tabs").pipe(
  Command.withDescription("Manage the tabs agents open"),
  Command.withSubcommands([tabsCleanup]),
)

const mcp = Command.make(
  "mcp",
  {},
  Effect.fn("Cli.mcp")(function* () {
    yield* runMcpServer
  }),
).pipe(Command.withDescription("Run the OpenCode Browser MCP server over stdio"))

export const opencodeBrowser = Command.make("opencode-browser").pipe(
  Command.withDescription("Control the user's existing browser through the OpenCode Browser extension"),
  Command.withSubcommands([serve, relay, execute, session, tabs, status, network, secrets, recording, flightRecorder, journal, doctor, skill, mcp]),
)

const mainLayer = Layer.mergeAll(RelayClient.layerFetch, SessionStore.layer).pipe(
  // CLI commands consume FileSystem directly in addition to SessionStore, so
  // Node services intentionally remain exposed downstream.
  Layer.provideMerge(NodeServices.layer),
)

Command.runWith(opencodeBrowser, { version: opencodeBrowserVersion })(normalizeCliArguments(process.argv.slice(2))).pipe(
  Effect.catchTags({
    "RelayClient.RelayRejected": (error) => Console.error(error.message).pipe(Effect.andThen(failExit)),
    "RelayClient.RelayUnreachable": (error) => Console.error(error.message).pipe(Effect.andThen(failExit)),
    "RelayClient.RelayDecodeFailed": (error) => Console.error(error.message).pipe(Effect.andThen(failExit)),
  }),
  Effect.provide(mainLayer),
  NodeRuntime.runMain,
)
