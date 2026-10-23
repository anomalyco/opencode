import crypto from "node:crypto"
import { Predicate } from "effect"
import { PageReadTimeoutError } from "./page-read-timeout.ts"
import { getIdText, getString } from "./relay-helpers.ts"
import type { ExecuteAftermath } from "./relay-schema.ts"
import type { JsonObject } from "./protocol.ts"

export type RuntimeFailureKind = "context-destroyed" | "context-missing" | "cross-extension-page" | "target-closed" | "timeout" | "other"

const maxDiagnosticTokenLength = 48

export function runtimeFailureKind(cause: unknown): RuntimeFailureKind {
  for (const message of errorMessages(cause)) {
    if (/cannot access a chrome-extension:\/\/ url of different extension/i.test(message)) {
      return "cross-extension-page"
    }
    if (/execution context was destroyed|context.*destroyed/i.test(message)) {
      return "context-destroyed"
    }
    if (/cannot find context with (?:specified )?id|execution context.*(?:not found|not available|does not exist)|context.*detached frame|frame (?:was|got) detached/i.test(message)) {
      return "context-missing"
    }
    if (/target page, context or browser has been closed|target closed|session closed/i.test(message)) {
      return "target-closed"
    }
    if (/timed out|timeout/i.test(message)) {
      return "timeout"
    }
  }
  return "other"
}

export function executionContextFailureDiagnostic(cause: unknown, aftermath: ExecuteAftermath | undefined): string | undefined {
  const kind = runtimeFailureKind(cause)
  if (kind === "cross-extension-page") {
    return "target/cross-extension-page"
  }
  for (const error of errorCauses(cause)) {
    if (error instanceof PageReadTimeoutError) {
      // This is read-deadline evidence, not a lost context requiring page recovery.
      return `session-page/context-read-timeout; operation=${error.operation}; timeoutMs=${error.timeoutMs}`
    }
  }
  if (kind !== "context-destroyed" && kind !== "context-missing") {
    return undefined
  }
  const pageClosed = aftermath?.endUrl === null
  const urlChanged = aftermath ? aftermath.startUrl !== aftermath.endUrl : false
  const navigationCount = aftermath?.navigations.length ?? 0
  return `execution-context/${kind}; pageClosed=${pageClosed}; urlChanged=${urlChanged}; mainFrameNavigations=${navigationCount}`
}

export function summarizeDiagnosticUrl(value: string | undefined): string {
  if (!value) {
    return "url=none"
  }
  const fingerprint = crypto.createHash("sha256").update(value).digest("hex").slice(0, 12)
  try {
    const parsed = new URL(value)
    const pathSegments = parsed.pathname.split("/").filter(Boolean).length
    const origin = parsed.origin === "null" ? `${parsed.protocol}//` : parsed.origin
    return `origin=${boundedToken(origin)} pathSegments=${pathSegments} query=${parsed.search ? "yes" : "no"} fragment=${parsed.hash ? "yes" : "no"} urlHash=${fingerprint}`
  } catch {
    return `url=unparseable chars=${value.length} urlHash=${fingerprint}`
  }
}

export function summarizeRuntimeEvaluate(params: JsonObject | undefined): string {
  const source = getString(params, "expression") ?? getString(params, "functionDeclaration")
  const sourceLength = source?.length ?? 0
  const rawContextId = getIdText(params, "contextId") ?? getIdText(params, "executionContextId")
  const contextId = rawContextId !== undefined ? boundedToken(rawContextId) : "default"
  return [
    `sourceChars=${sourceLength}`,
    `argumentCount=${Array.isArray(params?.arguments) ? params.arguments.length : 0}`,
    `context=${contextId}`,
    `awaitPromise=${params?.awaitPromise === true}`,
    `returnByValue=${params?.returnByValue === true}`,
    `userGesture=${params?.userGesture === true}`,
  ].join(" ")
}

export function boundedToken(value: string | undefined): string {
  if (!value) {
    return "none"
  }
  const normalized = value.replace(/[^a-zA-Z0-9:._/-]/g, "_")
  if (normalized.length <= maxDiagnosticTokenLength) {
    return normalized
  }
  return `${normalized.slice(0, maxDiagnosticTokenLength - 9)}~${crypto.createHash("sha256").update(value).digest("hex").slice(0, 8)}`
}

function errorMessages(cause: unknown): string[] {
  return errorCauses(cause).flatMap((error) => error instanceof Error ? [error.message] : Predicate.isString(error) ? [error] : [])
}

function errorCauses(cause: unknown): unknown[] {
  const causes: unknown[] = []
  const seen = new Set<unknown>()
  let current = cause
  for (let depth = 0; depth < 5 && current !== undefined && current !== null && !seen.has(current); depth++) {
    seen.add(current)
    causes.push(current)
    if (current instanceof Error) {
      current = current.cause
      continue
    }
    break
  }
  return causes
}
