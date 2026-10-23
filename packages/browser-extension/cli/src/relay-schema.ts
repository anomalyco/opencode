import { Schema } from "effect"

/**
 * Shared wire contract for the relay HTTP API.
 *
 * These schemas are the single source of truth for the JSON shapes exchanged
 * between the relay's HTTP responders (`src/http-api.ts`) and its clients
 * (`src/relay-client.ts`, used by the CLI and the MCP server). Server-side
 * producers derive their types from here so the contract cannot drift.
 */

export const SessionSummary = Schema.Struct({
  id: Schema.String,
  createdAt: Schema.String,
  updatedAt: Schema.String,
  connected: Schema.Boolean,
  pageUrl: Schema.NullOr(Schema.String),
  stateKeys: Schema.Array(Schema.String),
  readOnly: Schema.optionalKey(Schema.Boolean),
})

export interface SessionSummary extends Schema.Schema.Type<typeof SessionSummary> {}

export const ExecuteSessionSummary = SessionSummary.pipe(Schema.fieldsAssign({
  created: Schema.optionalKey(Schema.Boolean),
}))

export interface ExecuteSessionSummary extends Schema.Schema.Type<typeof ExecuteSessionSummary> {}

export const SessionContainer = Schema.Struct({
  session: SessionSummary,
})

export interface SessionContainer extends Schema.Schema.Type<typeof SessionContainer> {}

export const SessionsContainer = Schema.Struct({
  sessions: Schema.Array(SessionSummary),
})

export interface SessionsContainer extends Schema.Schema.Type<typeof SessionsContainer> {}

export const SessionDeleted = Schema.Struct({
  deleted: Schema.Boolean,
  id: Schema.String,
})

export interface SessionDeleted extends Schema.Schema.Type<typeof SessionDeleted> {}

export const TargetSelection = Schema.Struct({
  urlIncludes: Schema.optionalKey(Schema.NonEmptyString),
  index: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
}).check(Schema.makeFilter((selection) => {
  const hasUrl = selection.urlIncludes !== undefined
  const hasIndex = selection.index !== undefined
  return hasUrl !== hasIndex ? undefined : "targetSelection must contain exactly one of urlIncludes or index"
}))

export interface TargetSelection extends Schema.Schema.Type<typeof TargetSelection> {}

export const ExecuteRequest = Schema.Struct({
  sessionId: Schema.optionalKey(Schema.String),
  code: Schema.String,
  createIfMissing: Schema.Boolean,
  targetSelection: Schema.optionalKey(TargetSelection),
})

export interface ExecuteRequest extends Schema.Schema.Type<typeof ExecuteRequest> {}

export const SessionAdoptRequest = Schema.Struct({
  sessionId: Schema.optionalKey(Schema.String),
  createIfMissing: Schema.Boolean,
  targetSelection: Schema.optionalKey(TargetSelection),
  /** The Chrome tab id of an attached tab (the tab= value in status). */
  tabId: Schema.optionalKey(Schema.Int),
})

export interface SessionAdoptRequest extends Schema.Schema.Type<typeof SessionAdoptRequest> {}

export const SessionNewRequest = Schema.Struct({
  id: Schema.optionalKey(Schema.String),
  readOnly: Schema.optionalKey(Schema.Boolean),
})

export interface SessionNewRequest extends Schema.Schema.Type<typeof SessionNewRequest> {}

export const SessionEnsureRequest = Schema.Struct({
  id: Schema.NonEmptyString,
  readOnly: Schema.optionalKey(Schema.Boolean),
})

export interface SessionEnsureRequest extends Schema.Schema.Type<typeof SessionEnsureRequest> {}

export const SessionIdRequest = Schema.Struct({
  id: Schema.String,
})

export interface SessionIdRequest extends Schema.Schema.Type<typeof SessionIdRequest> {}

export const SessionAdoptResponse = Schema.Struct({
  session: ExecuteSessionSummary,
  adoptedUrl: Schema.String,
  adoptedTargetId: Schema.String,
})

export interface SessionAdoptResponse extends Schema.Schema.Type<typeof SessionAdoptResponse> {}

const ExecuteLogLocation = Schema.Struct({
  url: Schema.String,
  lineNumber: Schema.Number,
  columnNumber: Schema.Number,
})

interface ExecuteLogLocation extends Schema.Schema.Type<typeof ExecuteLogLocation> {}

export const ExecuteLogEntry = Schema.Struct({
  source: Schema.Literals(["script", "page"]),
  type: Schema.String,
  text: Schema.String,
  location: Schema.optionalKey(ExecuteLogLocation),
  repeatCount: Schema.optionalKey(Schema.Number),
})

export interface ExecuteLogEntry extends Schema.Schema.Type<typeof ExecuteLogEntry> {}

export const ExecuteLogSummary = Schema.Struct({
  totalCount: Schema.Number,
  returnedCount: Schema.Number,
  repeatedCount: Schema.Number,
  omittedCount: Schema.Number,
})

export interface ExecuteLogSummary extends Schema.Schema.Type<typeof ExecuteLogSummary> {}

/**
 * What changed in the browser during one execute call: URL movement, main
 * frame navigations, error counts, and human handoffs. Delivered with the
 * call that caused it so agents never fish warnings out of a later response.
 */
export const ExecuteAftermath = Schema.Struct({
  startUrl: Schema.NullOr(Schema.String),
  endUrl: Schema.NullOr(Schema.String),
  navigations: Schema.Array(Schema.String),
  consoleErrorCount: Schema.Number,
  pageErrorCount: Schema.Number,
  handoffs: Schema.Number,
})

export interface ExecuteAftermath extends Schema.Schema.Type<typeof ExecuteAftermath> {}

export const ExecuteMedia = Schema.Struct({
  type: Schema.Literal("image"),
  mimeType: Schema.String,
  data: Schema.String,
  size: Schema.Number,
})

export interface ExecuteMedia extends Schema.Schema.Type<typeof ExecuteMedia> {}

export const ExecuteResponse = Schema.Struct({
  text: Schema.String,
  value: Schema.optionalKey(Schema.Unknown),
  media: Schema.optionalKey(Schema.Array(ExecuteMedia)),
  isError: Schema.Boolean,
  logs: Schema.Array(ExecuteLogEntry),
  logSummary: Schema.optionalKey(ExecuteLogSummary),
  warnings: Schema.optionalKey(Schema.Array(Schema.String)),
  diagnostic: Schema.optionalKey(Schema.String),
  aftermath: Schema.optionalKey(ExecuteAftermath),
  session: ExecuteSessionSummary,
})

export interface ExecuteResponse extends Schema.Schema.Type<typeof ExecuteResponse> {}

export const AuthenticatedJsonMethod = Schema.Literals(["GET", "POST", "PUT", "PATCH", "DELETE"])

export type AuthenticatedJsonMethod = Schema.Schema.Type<typeof AuthenticatedJsonMethod>

export const AuthenticatedJsonRequest = Schema.Struct({
  sessionId: Schema.NonEmptyString,
  origin: Schema.NonEmptyString,
  startUrl: Schema.optionalKey(Schema.NonEmptyString),
  method: AuthenticatedJsonMethod,
  path: Schema.NonEmptyString,
  headers: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  body: Schema.optionalKey(Schema.Json),
  sensitive: Schema.optionalKey(Schema.Boolean),
  handoffOnAuthFailure: Schema.optionalKey(Schema.Boolean),
  handoffMessage: Schema.optionalKey(Schema.String),
  timeoutMs: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 120_000 }))),
  maxResponseBytes: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 10_000_000 }))),
})

export interface AuthenticatedJsonRequest extends Schema.Schema.Type<typeof AuthenticatedJsonRequest> {}

export const AuthenticatedJsonOutcome = Schema.TaggedUnion({
  Success: {
    status: Schema.Int,
    value: Schema.Json,
  },
  OriginMismatch: {
    expectedOrigin: Schema.String,
    actualOrigin: Schema.String,
  },
  RequestFailed: {
    outcome: Schema.Literals(["not-sent", "unknown"]),
  },
  HttpError: {
    status: Schema.Int,
  },
  ResponseTooLarge: {
    status: Schema.Int,
    maxResponseBytes: Schema.Int,
  },
  InvalidJson: {
    status: Schema.Int,
  },
  SensitiveCaptureActive: {},
})

export type AuthenticatedJsonOutcome = typeof AuthenticatedJsonOutcome.Type

export const TargetSummary = Schema.Struct({
  id: Schema.String,
  type: Schema.String,
  title: Schema.String,
  url: Schema.String,
  tabId: Schema.optionalKey(Schema.Number),
  sessionId: Schema.optionalKey(Schema.String),
  opencodeBrowserSessionId: Schema.optionalKey(Schema.String),
  owner: Schema.optionalKey(Schema.Literals(["relay", "user"])),
  crashed: Schema.optionalKey(Schema.Boolean),
  /** Chrome is rejecting debugger commands while another extension's UI is open in the tab. */
  protectedUi: Schema.optionalKey(Schema.Boolean),
})

export interface TargetSummary extends Schema.Schema.Type<typeof TargetSummary> {}

export const TargetSummaries = Schema.Array(TargetSummary)

export const ExtensionStatus = Schema.Struct({
  connected: Schema.Boolean,
  version: Schema.NullOr(Schema.String),
  /** When the connected extension was built: changes when a reload or update took effect. */
  build: Schema.optionalKey(Schema.NullOr(Schema.String)),
  /** The connected extension's origin: the store build or the unpacked one. */
  origin: Schema.optionalKey(Schema.NullOr(Schema.String)),
  protocolVersion: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  protocolCompatible: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
  protocolLegacy: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
  rejectedConnections: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  activeTargets: Schema.Number,
  childTargets: Schema.optionalKey(Schema.Number),
  cdpClients: Schema.optionalKey(Schema.Number),
  sessions: Schema.optionalKey(Schema.Array(SessionSummary)),
  targets: Schema.optionalKey(TargetSummaries),
})

export interface ExtensionStatus extends Schema.Schema.Type<typeof ExtensionStatus> {}

export const RelayVersion = Schema.Struct({
  version: Schema.String,
  buildId: Schema.optionalKey(Schema.String),
  instanceId: Schema.optionalKey(Schema.String),
  startedAt: Schema.optionalKey(Schema.String),
  pid: Schema.optionalKey(Schema.Number),
  managed: Schema.optionalKey(Schema.Boolean),
  shutdownProtocol: Schema.optionalKey(Schema.Literal(2)),
})

export interface RelayVersion extends Schema.Schema.Type<typeof RelayVersion> {}

// Unlike $, this end assertion rejects trailing line breaks in audit identifiers.
const RelayIdentity = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}(?![\s\S])/))
const RelayBuildId = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._:+-]{0,255}(?![\s\S])/))

export const RelayShutdownRequest = Schema.Struct({
  instanceId: RelayIdentity,
  requestId: RelayIdentity,
  reason: Schema.Literal("explicit-restart"),
  client: Schema.Struct({
    kind: Schema.Literals(["cli", "mcp", "sdk"]),
    instanceId: RelayIdentity,
    buildId: RelayBuildId,
  }),
})

export interface RelayShutdownRequest extends Schema.Schema.Type<typeof RelayShutdownRequest> {}

export const RelayShutdownResponse = Schema.Struct({
  stopping: Schema.Literal(true),
})

export interface RelayShutdownResponse extends Schema.Schema.Type<typeof RelayShutdownResponse> {}

const NetworkContentMode = Schema.Literals(["omit", "embed"])

export const NetworkStartRequest = Schema.Struct({
  sessionId: Schema.NonEmptyString,
  urlFilter: Schema.optionalKey(Schema.String),
  resourceTypes: Schema.optionalKey(Schema.Array(Schema.NonEmptyString).check(Schema.isMaxLength(50))),
  content: Schema.optionalKey(NetworkContentMode),
  maxBodyBytes: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 10_000_000 }))),
  maxTotalBodyBytes: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100_000_000 }))),
  maxEntries: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 10_000 }))),
})

export interface NetworkStartRequest extends Schema.Schema.Type<typeof NetworkStartRequest> {}

export const NetworkSessionRequest = Schema.Struct({ sessionId: Schema.NonEmptyString })
export interface NetworkSessionRequest extends Schema.Schema.Type<typeof NetworkSessionRequest> {}

export const NetworkStopRequest = NetworkSessionRequest.pipe(Schema.fieldsAssign({
  outputPath: Schema.optionalKey(Schema.String),
  secrets: Schema.optionalKey(Schema.NonEmptyString),
}))
export interface NetworkStopRequest extends Schema.Schema.Type<typeof NetworkStopRequest> {}

export const NetworkStatusResponse = Schema.Struct({
  active: Schema.Boolean,
  startedAt: Schema.optionalKey(Schema.String),
  entryCount: Schema.Number,
  responseCount: Schema.Number,
  failureCount: Schema.Number,
  capturedBodyBytes: Schema.Number,
  truncatedBodyCount: Schema.Number,
  droppedEntryCount: Schema.Number,
  urlFilter: Schema.optionalKey(Schema.String),
  resourceTypes: Schema.optionalKey(Schema.Array(Schema.String)),
  content: Schema.optionalKey(NetworkContentMode),
  secrets: Schema.optionalKey(Schema.String),
})
export interface NetworkStatusResponse extends Schema.Schema.Type<typeof NetworkStatusResponse> {}

const AuthProfileSlotSummary = Schema.Struct({
  ref: Schema.String,
  sources: Schema.Array(Schema.String),
  expiresAt: Schema.optionalKey(Schema.String),
  expired: Schema.Boolean,
})

export const AuthProfileSummary = Schema.Struct({
  name: Schema.String,
  createdAt: Schema.String,
  updatedAt: Schema.String,
  slotCount: Schema.Number,
  slots: Schema.Array(AuthProfileSlotSummary),
})
export interface AuthProfileSummary extends Schema.Schema.Type<typeof AuthProfileSummary> {}

const NetworkEndpointDigest = Schema.Struct({
  method: Schema.String,
  url: Schema.String,
  status: Schema.optionalKey(Schema.Number),
  count: Schema.Number,
  requestHeaders: Schema.optionalKey(Schema.Array(Schema.String)),
  requestKeys: Schema.optionalKey(Schema.Array(Schema.String)),
  responseKeys: Schema.optionalKey(Schema.Array(Schema.String)),
})

export const NetworkStopResponse = NetworkStatusResponse.pipe(Schema.fieldsAssign({
  active: Schema.Literal(false),
  stoppedAt: Schema.String,
  outputPath: Schema.optionalKey(Schema.String),
  authProfile: Schema.optionalKey(AuthProfileSummary),
  updatedSecretRefs: Schema.Array(Schema.String),
  observedSecretRefs: Schema.Array(Schema.String),
  endpoints: Schema.optionalKey(Schema.Array(NetworkEndpointDigest)),
}))
export interface NetworkStopResponse extends Schema.Schema.Type<typeof NetworkStopResponse> {}

export const NetworkCancelResponse = Schema.Struct({ cancelled: Schema.Boolean })
export interface NetworkCancelResponse extends Schema.Schema.Type<typeof NetworkCancelResponse> {}

export const AuthProfileRequest = Schema.Struct({ name: Schema.NonEmptyString })
export interface AuthProfileRequest extends Schema.Schema.Type<typeof AuthProfileRequest> {}

export const AuthRefreshRequest = Schema.Struct({
  sessionId: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  urlFilter: Schema.optionalKey(Schema.String),
  timeoutMs: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThan(0))),
})
export interface AuthRefreshRequest extends Schema.Schema.Type<typeof AuthRefreshRequest> {}

export const AuthRunRequest = Schema.Struct({
  name: Schema.NonEmptyString,
  command: Schema.NonEmptyString,
  args: Schema.optionalKey(Schema.Array(Schema.String)),
  cwd: Schema.optionalKey(Schema.String),
  timeoutMs: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThan(0))),
})
export interface AuthRunRequest extends Schema.Schema.Type<typeof AuthRunRequest> {}

export const AuthRunResponse = Schema.Struct({
  exitCode: Schema.Number,
  signal: Schema.NullOr(Schema.String),
  stdout: Schema.String,
  stderr: Schema.String,
  stdoutTruncated: Schema.Boolean,
  stderrTruncated: Schema.Boolean,
  durationMs: Schema.Number,
})
export interface AuthRunResponse extends Schema.Schema.Type<typeof AuthRunResponse> {}

const RecordingMode = Schema.Literals(["tab-capture", "cdp"])

const RecordingRequestedMode = Schema.Literals(["auto", "tab-capture", "cdp"])

const RecordingFrameRate = Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 60 }))

export const RecordingQuality = Schema.Struct({
  width: Schema.Number,
  height: Schema.Number,
  frameRate: Schema.Number,
  sourceFrameCount: Schema.Number,
  encodedSourceFrameCount: Schema.Number,
  coalescedFrameCount: Schema.Number,
  droppedFrameCount: Schema.Number,
  achievedSourceFrameRate: Schema.Number,
  achievedEncodedSourceFrameRate: Schema.Number,
  screenshotFallback: Schema.Boolean,
  sourceWidth: Schema.optionalKey(Schema.Number),
  sourceHeight: Schema.optionalKey(Schema.Number),
})

export interface RecordingQuality extends Schema.Schema.Type<typeof RecordingQuality> {}

export const RecordingTargetRequest = Schema.Struct({
  sessionId: Schema.optionalKey(Schema.String),
  tabId: Schema.optionalKey(Schema.Number),
})

export interface RecordingTargetRequest extends Schema.Schema.Type<typeof RecordingTargetRequest> {}

export const RecordingStartRequest = RecordingTargetRequest.pipe(Schema.fieldsAssign({
  outputPath: Schema.String,
  mode: Schema.optionalKey(RecordingRequestedMode),
  audio: Schema.optionalKey(Schema.Boolean),
  frameRate: Schema.optionalKey(RecordingFrameRate),
  videoBitsPerSecond: Schema.optionalKey(Schema.Number),
  audioBitsPerSecond: Schema.optionalKey(Schema.Number),
  maxDurationMs: Schema.optionalKey(Schema.Number),
}))

export interface RecordingStartRequest extends Schema.Schema.Type<typeof RecordingStartRequest> {}

const RecordingArtifactType = Schema.Literals(["webm", "mp4"])

export const RecordingStartResponse = Schema.Struct({
  success: Schema.Boolean,
  tabId: Schema.optionalKey(Schema.Number),
  startedAt: Schema.optionalKey(Schema.Number),
  path: Schema.optionalKey(Schema.String),
  mimeType: Schema.optionalKey(Schema.String),
  mode: Schema.optionalKey(RecordingMode),
  artifactType: Schema.optionalKey(RecordingArtifactType),
  frameRate: Schema.optionalKey(Schema.Number),
  error: Schema.optionalKey(Schema.String),
})

export interface RecordingStartResponse extends Schema.Schema.Type<typeof RecordingStartResponse> {}

export const RecordingStopResponse = Schema.Struct({
  success: Schema.Boolean,
  tabId: Schema.optionalKey(Schema.Number),
  duration: Schema.optionalKey(Schema.Number),
  path: Schema.optionalKey(Schema.String),
  size: Schema.optionalKey(Schema.Number),
  mode: Schema.optionalKey(RecordingMode),
  artifactType: Schema.optionalKey(RecordingArtifactType),
  frameCount: Schema.optionalKey(Schema.Number),
  quality: Schema.optionalKey(RecordingQuality),
  error: Schema.optionalKey(Schema.String),
})

export interface RecordingStopResponse extends Schema.Schema.Type<typeof RecordingStopResponse> {}

export const RecordingStatusResponse = Schema.Struct({
  isRecording: Schema.Boolean,
  tabId: Schema.optionalKey(Schema.Number),
  startedAt: Schema.optionalKey(Schema.Number),
  path: Schema.optionalKey(Schema.String),
  size: Schema.optionalKey(Schema.Number),
  mode: Schema.optionalKey(RecordingMode),
  artifactType: Schema.optionalKey(RecordingArtifactType),
  frameCount: Schema.optionalKey(Schema.Number),
  quality: Schema.optionalKey(RecordingQuality),
})

export interface RecordingStatusResponse extends Schema.Schema.Type<typeof RecordingStatusResponse> {}

export const TabsCleanupResponse = Schema.Struct({
  closed: Schema.Array(Schema.Struct({ tabId: Schema.Number, title: Schema.String, idleMinutes: Schema.Number })),
})
export type TabsCleanupResponse = typeof TabsCleanupResponse.Type

export const RecordingCancelResponse = Schema.Struct({
  success: Schema.Boolean,
  error: Schema.optionalKey(Schema.String),
})

export interface RecordingCancelResponse extends Schema.Schema.Type<typeof RecordingCancelResponse> {}

export const FlightRecorderStartRequest = RecordingTargetRequest.pipe(Schema.fieldsAssign({
  retentionMs: Schema.optionalKey(Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 1_000, maximum: 120_000 }))),
  frameRate: Schema.optionalKey(RecordingFrameRate),
}))
export interface FlightRecorderStartRequest extends Schema.Schema.Type<typeof FlightRecorderStartRequest> {}

export const FlightRecorderStatusResponse = Schema.Struct({
  active: Schema.Boolean,
  tabId: Schema.optionalKey(Schema.Number),
  sessionId: Schema.optionalKey(Schema.String),
  startedAt: Schema.optionalKey(Schema.Number),
  retentionMs: Schema.optionalKey(Schema.Number),
  retainedDurationMs: Schema.optionalKey(Schema.Number),
  frameRate: Schema.optionalKey(Schema.Number),
  bufferedFrames: Schema.optionalKey(Schema.Number),
  bufferedBytes: Schema.optionalKey(Schema.Number),
  sourceFrameCount: Schema.optionalKey(Schema.Number),
  droppedFrameCount: Schema.optionalKey(Schema.Number),
  saving: Schema.optionalKey(Schema.Boolean),
})
export interface FlightRecorderStatusResponse extends Schema.Schema.Type<typeof FlightRecorderStatusResponse> {}

export const FlightRecorderSaveRequest = RecordingTargetRequest.pipe(Schema.fieldsAssign({
  outputPath: Schema.String,
  durationMs: Schema.optionalKey(Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0))),
}))
export interface FlightRecorderSaveRequest extends Schema.Schema.Type<typeof FlightRecorderSaveRequest> {}

export const FlightRecorderSaveResponse = Schema.Struct({
  path: Schema.String,
  durationMs: Schema.Number,
  frameCount: Schema.Number,
  sourceFrameCount: Schema.Number,
  droppedFrameCount: Schema.Number,
})
export interface FlightRecorderSaveResponse extends Schema.Schema.Type<typeof FlightRecorderSaveResponse> {}

export const FlightRecorderCancelResponse = Schema.Struct({ cancelled: Schema.Boolean })
export interface FlightRecorderCancelResponse extends Schema.Schema.Type<typeof FlightRecorderCancelResponse> {}

export const RelayErrorCode = Schema.Literals([
  "invalid-request",
  "relay-starting",
  "relay-busy",
  "auth-profile-not-found",
  "capture-conflict",
  "session-already-exists",
  "session-inactive",
  "session-not-found",
  "session-timeout",
  "setup-failed",
  "target-ambiguous",
  "target-changed",
  "target-not-found",
  "target-owned",
  "internal",
])

export type RelayErrorCode = Schema.Schema.Type<typeof RelayErrorCode>

export const ErrorEnvelope = Schema.Struct({
  error: Schema.String,
  code: Schema.optionalKey(RelayErrorCode),
})

export interface ErrorEnvelope extends Schema.Schema.Type<typeof ErrorEnvelope> {}
