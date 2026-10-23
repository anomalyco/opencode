import { Effect, Predicate, Schema, Semaphore } from "effect"
import path from "node:path"
import type { Page, Request, Response } from "patchright-core"
import * as AuthProfile from "./auth-profile.ts"
import { writeJsonFileAtomically } from "./fs-durability.ts"
import { SecretCollector } from "./network-redaction.ts"

export type NetworkCaptureOptions = {
  readonly urlFilter?: string
  readonly resourceTypes?: readonly string[]
  readonly content?: "omit" | "embed"
  readonly maxBodyBytes?: number
  readonly maxTotalBodyBytes?: number
  readonly maxEntries?: number
}

export type NetworkCaptureStopOptions = {
  readonly outputPath?: string
  readonly secrets?: string
  readonly requireObservedSecrets?: boolean
}

export type NetworkCaptureStatus = {
  readonly active: boolean
  readonly startedAt?: string
  readonly entryCount: number
  readonly responseCount: number
  readonly failureCount: number
  readonly capturedBodyBytes: number
  readonly truncatedBodyCount: number
  readonly droppedEntryCount: number
  readonly urlFilter?: string
  readonly resourceTypes?: readonly string[]
  readonly content?: "omit" | "embed"
  readonly secrets?: string
}

type NetworkEndpointDigest = {
  readonly method: string
  readonly url: string
  readonly status?: number
  readonly count: number
  readonly requestHeaders?: readonly string[]
  readonly requestKeys?: readonly string[]
  readonly responseKeys?: readonly string[]
}

export type NetworkCaptureResult = NetworkCaptureStatus & {
  readonly active: false
  readonly stoppedAt: string
  readonly outputPath?: string
  readonly authProfile?: AuthProfile.AuthProfileSummary
  readonly updatedSecretRefs: readonly string[]
  readonly observedSecretRefs: readonly string[]
  readonly endpoints?: readonly NetworkEndpointDigest[]
}

export class NetworkCaptureError extends Schema.TaggedError<NetworkCaptureError>()(
  "NetworkCapture.Error",
  {
    message: Schema.String,
    operation: Schema.String,
    reason: Schema.Literals(["already-active", "inactive", "invalid-options", "finalize-failed", "persistence-failed"]),
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {}

type Header = { readonly name: string; readonly value: string }

type CapturedBody = {
  readonly size: number
  readonly mimeType: string
  readonly text?: string
  readonly truncated: boolean
}

type CapturedEntry = {
  readonly id: string
  readonly startedDateTime: string
  readonly durationMs: number
  readonly request: {
    readonly method: string
    readonly url: string
    readonly headers: readonly Header[]
    readonly resourceType: string
    readonly body?: CapturedBody
    readonly redirectedFrom?: string
  }
  readonly response?: {
    readonly status: number
    readonly statusText: string
    readonly headers: readonly Header[]
    readonly body?: CapturedBody
  }
  readonly failure?: string
}

type PendingEntry = {
  readonly id: string
  readonly startedAt: number
  readonly startedDateTime: string
  readonly request: Request
  response?: Response
  failure?: string
  finalized: boolean
  epoch: number
}

type FinalizeWork = {
  readonly pending: PendingEntry
  readonly generation: number
}

type ActiveCapture = {
  readonly startedAt: string
  readonly options: Required<Pick<NetworkCaptureOptions, "content" | "maxBodyBytes" | "maxTotalBodyBytes" | "maxEntries">> & NetworkCaptureOptions
  readonly pending: Map<Request, PendingEntry>
  readonly entries: CapturedEntry[]
  readonly finalizeQueue: FinalizeWork[]
  readonly finalizeWaiters: Set<() => void>
  readonly liveCollector: SecretCollector
  finalizeWorkers: number
  finalizeGeneration: number
  capturedBodyBytes: number
  truncatedBodyCount: number
  droppedEntryCount: number
  stopping: boolean
  cancelled: boolean
  outputUnsafe: boolean
}

const maxAllowedBodyBytes = 10_000_000
const maxAllowedTotalBodyBytes = 100_000_000
const maxAllowedEntries = 10_000
const maxAllowedResourceTypes = 50
const maxFinalizeWorkers = 4

export class Recorder {
  private active: ActiveCapture | undefined
  private page: Page | undefined
  private pageEpoch = 0
  private readonly transition = Semaphore.makeUnsafe(1)

  constructor(private readonly recorderOptions: {
    readonly authProfileBaseDir?: string
    readonly outputSettleTimeoutMs?: number
  } = {}) {}

  start(page: Page, options: NetworkCaptureOptions = {}): Effect.Effect<NetworkCaptureStatus, NetworkCaptureError> {
    const capture = this
    return this.transition.withPermit(Effect.try({
      try: () => {
        validateOptions(options)
        if (capture.active) {
          throw new NetworkCaptureError({ message: "Network capture is already active for this session", operation: "start", reason: "already-active" })
        }
        capture.active = {
          startedAt: new Date().toISOString(),
          options: {
            ...options,
            content: options.content ?? "embed",
            maxBodyBytes: options.maxBodyBytes ?? 1_000_000,
            maxTotalBodyBytes: options.maxTotalBodyBytes ?? 25_000_000,
            maxEntries: options.maxEntries ?? 1_000,
          },
          pending: new Map(),
          entries: [],
          finalizeQueue: [],
          finalizeWaiters: new Set(),
          liveCollector: new SecretCollector(),
          finalizeWorkers: 0,
          finalizeGeneration: 0,
          capturedBodyBytes: 0,
          truncatedBodyCount: 0,
          droppedEntryCount: 0,
          stopping: false,
          cancelled: false,
          outputUnsafe: false,
        }
        capture.bindPage(page)
        return capture.status()
      },
      catch: (cause) => cause instanceof NetworkCaptureError
        ? cause
        : new NetworkCaptureError({ message: "Invalid network capture options", operation: "start", reason: "invalid-options", cause }),
    }))
  }

  status(): NetworkCaptureStatus {
    const active = this.active
    if (!active) {
      return {
        active: false,
        entryCount: 0,
        responseCount: 0,
        failureCount: 0,
        capturedBodyBytes: 0,
        truncatedBodyCount: 0,
        droppedEntryCount: 0,
      }
    }
    return {
      active: true,
      startedAt: active.startedAt,
      entryCount: active.entries.length + active.pending.size,
      responseCount: active.entries.filter((entry) => entry.response).length,
      failureCount: active.entries.filter((entry) => entry.failure).length,
      capturedBodyBytes: active.capturedBodyBytes,
      truncatedBodyCount: active.truncatedBodyCount,
      droppedEntryCount: active.droppedEntryCount,
      ...(active.options.urlFilter ? { urlFilter: active.options.urlFilter } : {}),
      ...(active.options.resourceTypes ? { resourceTypes: [...active.options.resourceTypes] } : {}),
      content: active.options.content,
    }
  }

  stop(options: NetworkCaptureStopOptions = {}): Effect.Effect<NetworkCaptureResult, NetworkCaptureError> {
    const capture = this
    return this.transition.withPermit(Effect.gen(function* () {
      const active = capture.active
      if (!active) {
        return yield* new NetworkCaptureError({ message: "Network capture is not active for this session", operation: "stop", reason: "inactive" })
      }
      const boundPage = capture.page
      active.stopping = true
      capture.unbindPage()
      const operation = Effect.gen(function* () {
        for (const pending of [...active.pending.values()]) {
          if (!pending.finalized) {
            pending.failure ??= "Capture stopped before request completed"
            delete pending.response
          }
          capture.scheduleFinalize(pending)
        }
        const settled = yield* Effect.promise(() => settleFinalizers(active, 5_000))
        if (!settled) {
          active.droppedEntryCount += active.pending.size
          capture.discardFinalizers(active)
        }

        const secrets = options.secrets
        const profileOptions = capture.recorderOptions.authProfileBaseDir ? { baseDir: capture.recorderOptions.authProfileBaseDir } : {}
        const finish = finishCapture(active, options, secrets, profileOptions)
        const finished = yield* (secrets
          ? AuthProfile.withLock(secrets, profileOptions, finish)
          : finish
        ).pipe(
          Effect.mapError((cause) => cause instanceof NetworkCaptureError
            ? cause
            : new NetworkCaptureError({ message: cause.message, operation: "auth-profile", reason: "persistence-failed", cause })),
        )
        const finalStatus = capture.status()
        capture.active = undefined
        return {
          ...finalStatus,
          ...(secrets ? { secrets } : {}),
          truncatedBodyCount: finalStatus.truncatedBodyCount + finished.redactionOmissionCount,
          active: false as const,
          stoppedAt: new Date().toISOString(),
          ...(options.outputPath ? { outputPath: path.resolve(options.outputPath) } : {}),
          ...(finished.authProfile ? { authProfile: finished.authProfile } : {}),
          updatedSecretRefs: finished.updatedSecretRefs,
          observedSecretRefs: finished.observedSecretRefs,
          ...(finished.endpoints.length > 0 ? { endpoints: finished.endpoints } : {}),
        }
      }).pipe(
        Effect.tapError(() => Effect.sync(() => {
          active.stopping = false
          if (capture.active === active) capture.bindPage(boundPage)
        })),
      )
      return yield* operation
    })).pipe(Effect.uninterruptible)
  }

  cancel(): Effect.Effect<{ readonly cancelled: boolean }> {
    const capture = this
    return this.transition.withPermit(Effect.gen(function* () {
      const active = capture.active
      if (!active) return { cancelled: false }
      active.stopping = true
      active.cancelled = true
      capture.unbindPage()
      capture.discardFinalizers(active)
      yield* Effect.promise(() => settleFinalizers(active, 5_000))
      if (capture.active === active) capture.active = undefined
      return { cancelled: true }
    })).pipe(Effect.uninterruptible)
  }

  bindPage(page: Page | undefined): void {
    const active = this.active
    if (!active || active.stopping || this.page === page) return
    if (this.page) {
      for (const pending of active.pending.values()) {
        if (pending.epoch !== this.pageEpoch || pending.finalized) continue
        pending.failure ??= "Page changed before request completed"
        delete pending.response
        this.scheduleFinalize(pending)
      }
    }
    this.unbindPage()
    if (!page || page.isClosed()) return
    this.page = page
    this.pageEpoch += 1
    page.on("request", this.onRequest)
    page.on("response", this.onResponse)
    page.on("requestfinished", this.onRequestFinished)
    page.on("requestfailed", this.onRequestFailed)
  }

  async settleForOutput(): Promise<void> {
    const active = this.active
    if (!active) return
    active.outputUnsafe = !await settleFinalizers(active, this.recorderOptions.outputSettleTimeoutMs ?? 5_000)
  }

  redactText(text: string): string {
    const active = this.active
    if (!active) return text
    return active.outputUnsafe ? "[REDACTED: network capture finalization pending]" : active.liveCollector.redactText(text)
  }

  redactValue(value: unknown): unknown {
    const active = this.active
    if (!active) return value
    return active.outputUnsafe ? "[REDACTED: network capture finalization pending]" : active.liveCollector.redactValue(value)
  }

  redactUrl(url: string): string {
    const active = this.active
    if (!active) return url
    if (active.outputUnsafe) return "[REDACTED: network capture finalization pending]"
    return active.liveCollector.redactText(active.liveCollector.protectUrl(url, "execute"))
  }

  private readonly onRequest = (request: Request): void => {
    const active = this.active
    if (!active || !matches(request, active.options)) return
    if (active.entries.length + active.pending.size >= active.options.maxEntries) {
      active.droppedEntryCount += 1
      return
    }
    active.pending.set(request, {
      id: `request-${active.entries.length + active.pending.size + 1}`,
      startedAt: Date.now(),
      startedDateTime: new Date().toISOString(),
      request,
      finalized: false,
      epoch: this.pageEpoch,
    })
  }

  private readonly onResponse = (response: Response): void => {
    const pending = this.active?.pending.get(response.request())
    if (pending) pending.response = response
  }

  private readonly onRequestFinished = (request: Request): void => {
    const pending = this.active?.pending.get(request)
    if (pending) this.scheduleFinalize(pending)
  }

  private readonly onRequestFailed = (request: Request): void => {
    const pending = this.active?.pending.get(request)
    if (!pending) return
    pending.failure = request.failure()?.errorText ?? "Request failed"
    this.scheduleFinalize(pending)
  }

  private scheduleFinalize(pending: PendingEntry): void {
    const active = this.active
    if (!active || pending.finalized) return
    pending.finalized = true
    active.finalizeQueue.push({ pending, generation: active.finalizeGeneration })
    this.pumpFinalizers(active)
  }

  private pumpFinalizers(active: ActiveCapture): void {
    if (active.cancelled) active.finalizeQueue.length = 0
    while (!active.cancelled && active.finalizeWorkers < maxFinalizeWorkers) {
      const work = active.finalizeQueue.shift()
      if (!work) break
      active.finalizeWorkers += 1
      void this.finalize(work.pending, active, work.generation).catch(() => {}).finally(() => {
        active.finalizeWorkers -= 1
        this.pumpFinalizers(active)
        notifyFinalizersSettled(active)
      })
    }
    notifyFinalizersSettled(active)
  }

  private discardFinalizers(active: ActiveCapture): void {
    active.finalizeGeneration += 1
    active.finalizeQueue.length = 0
    active.pending.clear()
    notifyFinalizersSettled(active)
  }

  private async finalize(pending: PendingEntry, active: ActiveCapture, generation: number): Promise<void> {
      const request = pending.request
    try {
      const requestHeaders = await safeHeaders(() => request.headersArray())
      const requestLimit = Math.min(active.options.maxBodyBytes, active.options.maxTotalBodyBytes - active.capturedBodyBytes)
      const requestSize = declaredBodySize(requestHeaders)
      const requestMayHaveBody = requestSize !== undefined
        ? requestSize > 0
        : contentType(requestHeaders) !== undefined && !/^(GET|HEAD)$/i.test(request.method())
      const requestBody = active.options.content === "embed" && requestMayHaveBody
        ? bodyCanFit(requestHeaders, requestLimit)
          ? captureBuffer(request.postDataBuffer(), contentType(requestHeaders), active)
          : truncatedBody(contentType(requestHeaders), active, requestSize ?? 0)
        : undefined
      const response = pending.response
      const responseHeaders = response ? await safeHeaders(() => response.headersArray()) : []
      const shouldCaptureResponseBody = response && active.options.content === "embed"
      const hasBodyBudget = active.capturedBodyBytes < active.options.maxTotalBodyBytes
      let responseBody: CapturedBody | undefined
      if (shouldCaptureResponseBody) {
        if (hasBodyBudget) {
          const responseBuffer = bodyCanFit(responseHeaders, Math.min(active.options.maxBodyBytes, active.options.maxTotalBodyBytes - active.capturedBodyBytes))
            ? await bodyWithTimeout(response, 1_000)
            : null
          responseBody = responseBuffer === null
            ? truncatedBody(contentType(responseHeaders), active, declaredBodySize(responseHeaders) ?? 0)
            : captureBuffer(responseBuffer, contentType(responseHeaders), active)
        } else {
          responseBody = truncatedBody(contentType(responseHeaders), active)
        }
      }
      const redirectedFrom = request.redirectedFrom()?.url()
      this.recordEntry(active, generation, {
        id: pending.id,
        startedDateTime: pending.startedDateTime,
        durationMs: Math.max(0, Date.now() - pending.startedAt),
        request: {
          method: request.method(),
          url: request.url(),
          headers: requestHeaders,
          resourceType: request.resourceType(),
          ...(requestBody ? { body: requestBody } : {}),
          ...(redirectedFrom ? { redirectedFrom } : {}),
        },
        ...(response ? {
          response: {
            status: response.status(),
            statusText: response.statusText(),
            headers: responseHeaders,
            ...(responseBody ? { body: responseBody } : {}),
          },
        } : {}),
        ...(pending.failure ? { failure: pending.failure } : {}),
      })
    } catch {
      this.recordEntry(active, generation, {
        id: pending.id,
        startedDateTime: pending.startedDateTime,
        durationMs: Math.max(0, Date.now() - pending.startedAt),
        request: {
          method: safeValue(() => request.method(), "UNKNOWN"),
          url: safeValue(() => request.url(), ""),
          headers: [],
          resourceType: safeValue(() => request.resourceType(), "unknown"),
        },
        failure: "Capture finalization failed",
      })
    } finally {
      active.pending.delete(request)
    }
  }

  private recordEntry(active: ActiveCapture, generation: number, entry: CapturedEntry): void {
    if (active.cancelled || generation !== active.finalizeGeneration) return
    active.entries.push(entry)
    protectEntry(entry, active.liveCollector)
  }

  private unbindPage(): void {
    const page = this.page
    this.page = undefined
    if (!page) return
    page.off("request", this.onRequest)
    page.off("response", this.onResponse)
    page.off("requestfinished", this.onRequestFinished)
    page.off("requestfailed", this.onRequestFailed)
  }
}

function finishCapture(
  active: ActiveCapture,
  options: NetworkCaptureStopOptions,
  secrets: string | undefined,
  profileOptions: { readonly baseDir?: string },
): Effect.Effect<{
  readonly authProfile?: AuthProfile.AuthProfileSummary
  readonly updatedSecretRefs: readonly string[]
  readonly observedSecretRefs: readonly string[]
  readonly redactionOmissionCount: number
  readonly endpoints: readonly NetworkEndpointDigest[]
}, NetworkCaptureError | AuthProfile.AuthProfileError> {
  return Effect.gen(function* () {
    const existingProfile = secrets
      ? yield* AuthProfile.readOptional(secrets, profileOptions)
      : undefined
    const collector = new SecretCollector(existingProfile?.slots ?? [])
    const structurallyProtected = active.entries.map((entry) => protectEntry(entry, collector))
    const protectedEntries = structurallyProtected.map((entry) => redactEntryKnownValues(entry, collector))
    if (options.requireObservedSecrets && collector.observedRefs().length === 0) {
      return yield* new NetworkCaptureError({
        message: `Auth refresh did not observe credentials for profile ${secrets ?? "unknown"}`,
        operation: "auth-profile",
        reason: "persistence-failed",
      })
    }
    const authProfile = secrets
      ? yield* AuthProfile.write({ name: secrets, slots: collector.slots(), ...profileOptions })
      : undefined
    if (options.outputPath) {
      yield* writeArtifact(options.outputPath, {
        log: {
          version: "1.2",
          creator: { name: "OpenCode Browser", version: "1" },
          entries: protectedEntries.map(toHarEntry),
        },
      })
    }
    return {
      ...(authProfile ? { authProfile } : {}),
      updatedSecretRefs: collector.updatedRefs(),
      observedSecretRefs: collector.observedRefs(),
      redactionOmissionCount: options.outputPath ? countRedactionOmissions(active.entries, protectedEntries) : 0,
      endpoints: summarizeEndpoints(protectedEntries),
    }
  })
}

function extractTopLevelJsonKeys(body: CapturedBody | undefined): readonly string[] | undefined {
  if (!body?.text || !body.mimeType.toLowerCase().includes("json")) return undefined
  try {
    const parsed: unknown = JSON.parse(body.text)
    if (Predicate.isObject(parsed) && !Array.isArray(parsed)) {
      const keys = Object.keys(parsed).slice(0, 15)
      return keys.length > 0 ? keys : undefined
    }
  } catch {}
  return undefined
}

function summarizeEndpoints(entries: readonly CapturedEntry[]): readonly NetworkEndpointDigest[] {
  const byRoute = new Map<string, NetworkEndpointDigest>()
  for (const entry of entries) {
    if (["image", "stylesheet", "font", "media"].includes(entry.request.resourceType)) continue
    let routePath = entry.request.url
    try {
      const u = new URL(entry.request.url)
      routePath = `${u.origin}${u.pathname}`
    } catch {}
    const key = `${entry.request.method} ${routePath}`
    const existing = byRoute.get(key)
    const notableHeaders = entry.request.headers
      .filter((h) => {
        const lower = h.name.toLowerCase()
        if (lower === "x-client-data" || lower.startsWith("sec-ch-")) return false
        return h.value.includes("${BC_SECRET_") || lower === "authorization" || lower.startsWith("x-")
      })
      .slice(0, 8)
      .map((h) => `${h.name}: ${h.value.slice(0, 80)}`)
    const requestKeys = extractTopLevelJsonKeys(entry.request.body)
    const responseKeys = extractTopLevelJsonKeys(entry.response?.body)
    byRoute.set(key, {
      method: entry.request.method,
      url: entry.request.url.slice(0, 240),
      ...(entry.response ? { status: entry.response.status } : existing?.status !== undefined ? { status: existing.status } : {}),
      count: (existing?.count ?? 0) + 1,
      ...(notableHeaders.length > 0 ? { requestHeaders: notableHeaders } : existing?.requestHeaders ? { requestHeaders: existing.requestHeaders } : {}),
      ...(requestKeys ? { requestKeys } : existing?.requestKeys ? { requestKeys: existing.requestKeys } : {}),
      ...(responseKeys ? { responseKeys } : existing?.responseKeys ? { responseKeys: existing.responseKeys } : {}),
    })
    if (byRoute.size >= 30) break
  }
  return [...byRoute.values()]
}

function countRedactionOmissions(original: readonly CapturedEntry[], protectedEntries: readonly CapturedEntry[]): number {
  let count = 0
  for (let index = 0; index < original.length; index += 1) {
    const before = original[index]
    const after = protectedEntries[index]
    if (before?.request.body?.text && !before.request.body.truncated && !after?.request.body?.text) count += 1
    if (before?.response?.body?.text && !before.response.body.truncated && !after?.response?.body?.text) count += 1
  }
  return count
}

function matches(request: Request, options: ActiveCapture["options"]): boolean {
  if (options.urlFilter && !request.url().includes(options.urlFilter)) return false
  return !options.resourceTypes || options.resourceTypes.includes(request.resourceType())
}

function validateOptions(options: NetworkCaptureOptions): void {
  if (options.content !== undefined && options.content !== "embed" && options.content !== "omit") {
    throw new NetworkCaptureError({ message: "Network content must be embed or omit", operation: "start", reason: "invalid-options" })
  }
  validateLimit("maxBodyBytes", options.maxBodyBytes, maxAllowedBodyBytes)
  validateLimit("maxTotalBodyBytes", options.maxTotalBodyBytes, maxAllowedTotalBodyBytes)
  validateLimit("maxEntries", options.maxEntries, maxAllowedEntries)
  if (options.resourceTypes && options.resourceTypes.length > maxAllowedResourceTypes) {
    throw new NetworkCaptureError({ message: `resourceTypes cannot contain more than ${maxAllowedResourceTypes} values`, operation: "start", reason: "invalid-options" })
  }
}

function validateLimit(name: string, value: number | undefined, maximum: number): void {
  if (value === undefined) return
  if (!Number.isInteger(value) || value <= 0 || value > maximum) {
    throw new NetworkCaptureError({ message: `${name} must be an integer from 1 to ${maximum}`, operation: "start", reason: "invalid-options" })
  }
}

function captureBuffer(buffer: Buffer | null, mimeType: string | undefined, active: ActiveCapture): CapturedBody | undefined {
  if (!buffer) return undefined
  const remaining = Math.max(0, active.options.maxTotalBodyBytes - active.capturedBodyBytes)
  const captureBytes = Math.min(buffer.length, active.options.maxBodyBytes, remaining)
  const truncated = captureBytes < buffer.length
  active.capturedBodyBytes += captureBytes
  const textual = isTextualMimeType(mimeType)
  const omitted = truncated || !textual
  if (omitted) active.truncatedBodyCount += 1
  return {
    size: buffer.length,
    mimeType: mimeType ?? "application/octet-stream",
    ...(!truncated && textual ? { text: buffer.toString("utf8", 0, captureBytes) } : {}),
    truncated: omitted,
  }
}

function bodyCanFit(headers: readonly Header[], limit: number): boolean {
  if (limit <= 0) return false
  const length = declaredBodySize(headers)
  const encoding = header(headers, "content-encoding")?.trim().toLowerCase()
  const supportedEncoding = !encoding || encoding === "identity" || encoding === "gzip" || encoding === "br" || encoding === "deflate" || encoding === "zstd"
  if (!supportedEncoding) return false
  if (length !== undefined) return length <= limit
  return Boolean(encoding && isTextualMimeType(contentType(headers)))
}

function declaredBodySize(headers: readonly Header[]): number | undefined {
  const value = header(headers, "content-length")
  if (!value) return undefined
  const length = Number(value)
  return Number.isSafeInteger(length) && length >= 0 ? length : undefined
}

function truncatedBody(mimeType: string | undefined, active: ActiveCapture, size = 0): CapturedBody {
  active.truncatedBodyCount += 1
  return { size, mimeType: mimeType ?? "application/octet-stream", truncated: true }
}

function protectEntry(entry: CapturedEntry, collector: SecretCollector): CapturedEntry {
  const scope = requestScope(entry.request.method, entry.request.url)
  const requestHeaders = collector.protectHeaders(entry.request.headers, "request", scope)
  const responseHeaders = entry.response ? collector.protectHeaders(entry.response.headers, "response", scope) : undefined
  const requestBody = protectCapturedBody(entry.request.body, collector, "request", scope)
  const responseBody = protectCapturedBody(entry.response?.body, collector, "response", scope)
  return {
    ...entry,
    request: {
      ...entry.request,
      url: collector.protectUrl(entry.request.url, scope),
      headers: requestHeaders,
      ...(requestBody ? { body: requestBody } : {}),
      ...(entry.request.redirectedFrom ? { redirectedFrom: collector.protectUrl(entry.request.redirectedFrom, scope) } : {}),
    },
    ...(entry.response ? {
      response: {
        ...entry.response,
        headers: responseHeaders ?? [],
        ...(responseBody ? { body: responseBody } : {}),
      },
    } : {}),
  }
}

function protectCapturedBody(
  body: CapturedBody | undefined,
  collector: SecretCollector,
  location: "request" | "response",
  scope: string,
): CapturedBody | undefined {
  if (!body) return undefined
  if (!body.text) {
    return { size: body.size, mimeType: body.mimeType, truncated: true }
  }
  const text = collector.protectBody(body.text, body.mimeType, location, scope)
  return text === undefined
    ? { size: body.size, mimeType: body.mimeType, truncated: true }
    : { ...body, text }
}

function redactEntryKnownValues(entry: CapturedEntry, collector: SecretCollector): CapturedEntry {
  return {
    ...entry,
    request: {
      ...entry.request,
      ...(entry.request.body?.text ? { body: redactStructuredBody(entry.request.body, collector) } : {}),
    },
    ...(entry.response ? {
      response: {
        ...entry.response,
        ...(entry.response.body?.text ? { body: redactStructuredBody(entry.response.body, collector) } : {}),
      },
    } : {}),
  }
}

function redactStructuredBody(body: CapturedBody, collector: SecretCollector): CapturedBody {
  if (!body.text || !body.mimeType.toLowerCase().includes("json")) return body
  try {
    return { ...body, text: JSON.stringify(redactKnownScalars(JSON.parse(body.text), collector)) }
  } catch {
    return { size: body.size, mimeType: body.mimeType, truncated: true }
  }
}

function redactKnownScalars(value: unknown, collector: SecretCollector): unknown {
  if (Array.isArray(value)) return value.map((item) => redactKnownScalars(item, collector))
  if (Predicate.isObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactKnownScalars(item, collector)]))
  }
  return collector.redactExactValue(value, 8)
}

function toHarEntry(entry: CapturedEntry): Record<string, unknown> {
  return {
    startedDateTime: entry.startedDateTime,
    time: entry.durationMs,
    request: {
      method: entry.request.method,
      url: entry.request.url,
      httpVersion: "",
      cookies: [],
      headers: entry.request.headers,
      queryString: queryString(entry.request.url),
      headersSize: -1,
      bodySize: entry.request.body?.size ?? 0,
      ...(entry.request.body?.text ? {
        postData: { mimeType: entry.request.body.mimeType, text: entry.request.body.text },
      } : {}),
    },
    response: entry.response ? {
      status: entry.response.status,
      statusText: entry.response.statusText,
      httpVersion: "",
      cookies: [],
      headers: entry.response.headers,
      content: {
        size: entry.response.body?.size ?? 0,
        mimeType: entry.response.body?.mimeType ?? contentType(entry.response.headers) ?? "application/octet-stream",
        ...(entry.response.body?.text ? { text: entry.response.body.text } : {}),
      },
      redirectURL: header(entry.response.headers, "location") ?? "",
      headersSize: -1,
      bodySize: entry.response.body?.size ?? 0,
    } : { status: 0, statusText: entry.failure ?? "No response", httpVersion: "", cookies: [], headers: [], content: { size: 0, mimeType: "application/octet-stream" }, redirectURL: "", headersSize: -1, bodySize: 0 },
    cache: {},
    timings: { send: 0, wait: entry.durationMs, receive: 0 },
    _opencodeBrowser: {
      id: entry.id,
      resourceType: entry.request.resourceType,
      ...(entry.request.redirectedFrom ? { redirectedFrom: entry.request.redirectedFrom } : {}),
      ...(entry.failure ? { failure: entry.failure } : {}),
      requestBodyTruncated: entry.request.body?.truncated ?? false,
      responseBodyTruncated: entry.response?.body?.truncated ?? false,
    },
  }
}

function writeArtifact(outputPath: string, value: unknown): Effect.Effect<void, NetworkCaptureError> {
  return Effect.tryPromise({
    try: () => writeJsonFileAtomically(path.resolve(outputPath), value),
    catch: (cause) => new NetworkCaptureError({ message: `Could not write network capture: ${outputPath}`, operation: "write", reason: "persistence-failed", cause }),
  })
}

async function safeHeaders(read: () => Promise<Header[]>): Promise<Header[]> {
  return read().catch(() => [])
}

async function bodyWithTimeout(response: Response, timeoutMs: number): Promise<Buffer | null> {
  let timeout: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      response.body().catch(() => null),
      new Promise<null>((resolve) => {
        timeout = setTimeout(() => resolve(null), timeoutMs)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

async function settleFinalizers(active: ActiveCapture, timeoutMs: number): Promise<boolean> {
  if (active.pending.size === 0 && active.finalizeQueue.length === 0 && active.finalizeWorkers === 0) return true
  let timeout: NodeJS.Timeout | undefined
  let waiter: (() => void) | undefined
  try {
    return await Promise.race([
      new Promise<true>((resolve) => {
        waiter = () => resolve(true)
        active.finalizeWaiters.add(waiter)
      }),
      new Promise<false>((resolve) => {
        timeout = setTimeout(() => resolve(false), timeoutMs)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
    if (waiter) active.finalizeWaiters.delete(waiter)
  }
}

function notifyFinalizersSettled(active: ActiveCapture): void {
  if (active.pending.size > 0 || active.finalizeQueue.length > 0 || active.finalizeWorkers > 0) return
  for (const resolve of active.finalizeWaiters) resolve()
  active.finalizeWaiters.clear()
}

function safeValue<A>(read: () => A, fallback: A): A {
  try {
    return read()
  } catch {
    return fallback
  }
}

function requestScope(method: string, rawUrl: string): string {
  try {
    const url = new URL(rawUrl)
    return `${method.toUpperCase()} ${url.origin}${url.pathname}`
  } catch {
    return `${method.toUpperCase()} ${rawUrl.split("?", 1)[0] ?? rawUrl}`
  }
}

function contentType(headers: readonly Header[]): string | undefined {
  return header(headers, "content-type")?.trim()
}

function header(headers: readonly Header[], name: string): string | undefined {
  return headers.find((candidate) => candidate.name.toLowerCase() === name)?.value
}

function queryString(rawUrl: string): Array<{ name: string; value: string }> {
  try {
    return Array.from(new URL(rawUrl).searchParams, ([name, value]) => ({ name, value }))
  } catch {
    return []
  }
}

function isTextualMimeType(mimeType: string | undefined): boolean {
  return !mimeType || mimeType.startsWith("text/") || /json|javascript|xml|x-www-form-urlencoded|multipart\/form-data|graphql/.test(mimeType)
}
