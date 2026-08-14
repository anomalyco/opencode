export interface Annotation {
  readonly id: string
  readonly row: number
  readonly column: number
  readonly note: string
}

export interface AnnotationDocument {
  readonly version: 1
  readonly identifier: string
  readonly variant: string
  readonly annotations: ReadonlyArray<Annotation>
}

const FragmentKey = "annotations"
const MaxAnnotations = 24
const MaxNoteLength = 2_000

export function annotationUrl(deepLink: string, document: AnnotationDocument) {
  const url = new URL(deepLink)
  url.hash = `${FragmentKey}=${encode(document)}`
  return url.href
}

export function readAnnotations(url: URL, identifier: string, variant: string): ReadonlyArray<Annotation> {
  const params = new URLSearchParams(url.hash.slice(1))
  const encoded = params.get(FragmentKey)
  if (!encoded) return []
  const value = decode(encoded)
  if (!isDocument(value) || value.identifier !== identifier || value.variant !== variant) return []
  return value.annotations
}

export function readAnnotationDraft(value: string): ReadonlyArray<Annotation> {
  try {
    const annotations: unknown = JSON.parse(value)
    return isAnnotations(annotations) ? annotations : []
  } catch {
    return []
  }
}

function encode(value: AnnotationDocument) {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "")
}

function decode(value: string): unknown {
  try {
    const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/"))
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0))))
  } catch {
    return undefined
  }
}

function isDocument(value: unknown): value is AnnotationDocument {
  if (!value || typeof value !== "object") return false
  const document = value as Partial<AnnotationDocument>
  if (document.version !== 1 || typeof document.identifier !== "string" || typeof document.variant !== "string")
    return false
  return isAnnotations(document.annotations)
}

function isAnnotations(value: unknown): value is ReadonlyArray<Annotation> {
  if (!Array.isArray(value) || value.length > MaxAnnotations) return false
  return value.every(
    (annotation) =>
      annotation &&
      typeof annotation === "object" &&
      typeof annotation.id === "string" &&
      Number.isInteger(annotation.row) &&
      annotation.row >= 0 &&
      Number.isInteger(annotation.column) &&
      annotation.column >= 0 &&
      typeof annotation.note === "string" &&
      annotation.note.length <= MaxNoteLength,
  )
}
