import { REDACTED, isSensitiveBrowserName, isSensitiveBrowserValue, redactSensitiveBrowserNames, redactSensitiveBrowserText, redactSensitiveBrowserUrl } from "../logging"
import type { BrowserAnnotationData, BrowserInspectResult, BrowserSnapshot, BrowserSnapshotElement } from "./types"

export const browserDomLimits = {
  maxSnapshotElements: 100,
  maxTextLength: 200,
  maxAttributeValueLength: 200,
  maxNearbyTextLength: 500,
} as const

const redactedAttributeNames = new Set(["alt", "id", "name", "placeholder", "title", "type", "value"])
const quotedLocatorLiteral = /(['"])([^'"\\]*(?:\\.[^'"\\]*)*)\1/g
const bracketLocatorLiteral = /\[\s*@?([^\]=\s]+)\s*=\s*(?:(['"])(.*?)\2|([^\]'"\s][^\]]*))\s*\]/g
const simpleLocatorIdentifier = /[#.]([a-z0-9_-]+)/gi
const sensitiveLocatorLiteral = /(?:^|[^a-z0-9])(pass(?:word|code)?|secret|token|authorization|cookie|sessionid|api(?:-|_)?key|bearer|credential)(?:[^a-z0-9]|$)/i

function normalizeDomText(text: string) {
  return (text ?? "")
    .replace(/[\x00-\x1F\x7F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function redactText(text: string, maxLength: number, redactNames = false) {
  const value = redactSensitiveBrowserText(normalizeDomText(text))
  return (redactNames ? redactSensitiveBrowserNames(value) : value).slice(0, maxLength)
}

function isSensitiveLocatorLiteral(value: string) {
  return isSensitiveBrowserValue(value) || sensitiveLocatorLiteral.test(value)
}

function hasSensitiveLocatorLiteral(value: string) {
  if ([...value.matchAll(simpleLocatorIdentifier)].some((match) => isSensitiveLocatorLiteral(match[1]))) return true
  if (
    [...value.matchAll(bracketLocatorLiteral)].some(
      (match) => isSensitiveBrowserName(match[1]) || isSensitiveLocatorLiteral(match[3] || match[4] || ""),
    )
  ) return true
  return [...value.matchAll(quotedLocatorLiteral)].some((match) => isSensitiveLocatorLiteral(match[2]))
}

function isSensitiveElement(element: Pick<BrowserSnapshotElement, "selector" | "accessibleName" | "visibleText" | "attributes">) {
  const attributes = element.attributes ?? {}
  return hasSensitiveLocatorLiteral(element.selector) || [
    attributes.id,
    attributes.name,
    attributes.placeholder,
    attributes.title,
    attributes.type,
  ].some((value) => !!value && isSensitiveBrowserName(value)) || (!!attributes.value && isSensitiveBrowserValue(attributes.value))
}

function sanitizeAttributeValue(name: string, value: string, sensitiveElement: boolean) {
  if (!value) return value
  if (name === "href") return redactSensitiveBrowserUrl(value).slice(0, browserDomLimits.maxAttributeValueLength)
  if (sensitiveElement && redactedAttributeNames.has(name)) return REDACTED
  if (isSensitiveBrowserName(name) || isSensitiveBrowserValue(value)) return REDACTED
  if (isSensitiveBrowserName(value)) return REDACTED
  return redactText(value, browserDomLimits.maxAttributeValueLength)
}

function sanitizeAttributes(attributes: Record<string, string>, sensitiveElement: boolean) {
  return Object.fromEntries(
    Object.entries(attributes ?? {}).map(([name, value]) => [name, sanitizeAttributeValue(name, value, sensitiveElement)]),
  )
}

function sanitizeElement(element: BrowserSnapshotElement): BrowserSnapshotElement {
  const sensitiveElement = isSensitiveElement(element)
  return {
    ...element,
    selector: sanitizeLocator(element.selector, sensitiveElement),
    accessibleName: element.accessibleName ? (sensitiveElement ? REDACTED : redactText(element.accessibleName, browserDomLimits.maxTextLength)) : undefined,
    visibleText: element.visibleText ? (sensitiveElement ? REDACTED : redactText(element.visibleText, browserDomLimits.maxTextLength)) : undefined,
    attributes: sanitizeAttributes(element.attributes, sensitiveElement),
  }
}

function sanitizeLocator(value: string, sensitiveElement: boolean) {
  if (sensitiveElement || hasSensitiveLocatorLiteral(value)) return REDACTED
  return value.slice(0, browserDomLimits.maxTextLength)
}

export async function extractAnnotation(selector: string) {
  const { getAnnotationData } = await import("./BrowserManager")
  return getAnnotationData(selector)
}

export function sanitizeDomText(text: string, maxLength: number = browserDomLimits.maxNearbyTextLength, redactNames = false) {
  return redactText(text, maxLength, redactNames)
}

export function sanitizeBrowserSnapshot(snapshot: BrowserSnapshot): BrowserSnapshot {
  return {
    ...snapshot,
    url: redactSensitiveBrowserUrl(snapshot.url),
    title: sanitizeDomText(snapshot.title, browserDomLimits.maxTextLength),
    elements: snapshot.elements.slice(0, browserDomLimits.maxSnapshotElements).map(sanitizeElement),
  }
}

export function sanitizeBrowserAnnotationData(annotation: BrowserAnnotationData | null) {
  if (!annotation) return null
  const element = sanitizeElement(annotation)
  return {
    ...annotation,
    ...element,
    xpath: annotation.xpath ? sanitizeLocator(annotation.xpath, isSensitiveElement(annotation)) : undefined,
    nearbyDomSanitized: sanitizeDomText(annotation.nearbyDomSanitized, browserDomLimits.maxNearbyTextLength, isSensitiveElement(annotation)),
  }
}

export function sanitizeBrowserInspectResult(result: BrowserInspectResult | null) {
  if (!result) return null
  const annotation = sanitizeBrowserAnnotationData(result.annotation)
  if (!annotation) return null
  return {
    ...result,
    annotation,
    pageTitle: sanitizeDomText(result.pageTitle, browserDomLimits.maxTextLength),
    pageUrl: redactSensitiveBrowserUrl(result.pageUrl),
    userComment: result.userComment.trim(),
  }
}
