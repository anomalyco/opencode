import { artifactKind, artifactMime, type ArtifactKind } from "@opencode/util/artifact"
import type { FileContent } from "@opencode/plugin/gui"

/** Kinds whose raw bytes are kept so media elements and binary viewers can read them without a text round trip. */
const binaryKinds = new Set<ArtifactKind>([
  "image",
  "audio",
  "video",
  "pdf",
  "font",
  "document",
  "spreadsheet",
  "presentation",
])

/** Kinds a media element reads straight from the server, so it shows the first frame before the rest arrives. */
export const streamedKinds = new Set<ArtifactKind>(["image", "audio", "video"])

/** Kinds whose text preview fetches at most the leading byte range so multi-megabyte files stay responsive. */
export const boundedKinds = new Set<ArtifactKind>(["table"])

/** Maximum bytes fetched for a bounded preview; enough for hundreds to 1,000 rows without stalling on huge files. */
export const MAX_PREVIEW_BYTES = 1024 * 1024

// As long as the API's request queue waits for a response (`request-queue.ts`), which direct fetches skip.
const HEAD_RESPONSE_TIMEOUT_MS = 60_000

function fetchWithHeadersTimeout(
  fetch: (url: string, init: RequestInit) => Promise<Response>,
  url: string,
  init: RequestInit,
  signal: AbortSignal,
) {
  const deadline = new AbortController()

  const timer = setTimeout(
    () => deadline.abort(new DOMException("signal timed out", "TimeoutError")),
    HEAD_RESPONSE_TIMEOUT_MS,
  )

  return fetch(url, { ...init, signal: AbortSignal.any([signal, deadline.signal]) }).finally(() =>
    clearTimeout(timer),
  )
}

/**
 * A HEAD of a streamed file's URL that gives up when the server sends no response in time, so a dead connection fails
 * the load instead of leaving it loading. A HEAD has no body, so the deadline ends with the response.
 */
export function headStreamedFile(
  fetch: (url: string, init: RequestInit) => Promise<Response>,
  url: string,
  signal: AbortSignal,
) {
  return fetchWithHeadersTimeout(fetch, url, { method: "HEAD" }, signal)
}

/** Content for a streamed file from a HEAD of its URL. A changed file gets a new URL, so its element reloads. */
export function streamedFileContent(path: string, url: string, response: Response): FileContent {
  const size = Number(response.headers.get("content-length") ?? 0)
  const versioned = new URL(url)
  versioned.searchParams.set("v", `${size}-${Date.parse(response.headers.get("last-modified") ?? "") || 0}`)

  return { type: "binary", content: "", size, mimeType: artifactMime(path), url: versioned.href }
}

function parseContentRangeTotal(header: string | null) {
  const match = header ? /^bytes\s+\d+-\d+\/(\d+)$/i.exec(header.trim()) : null

  return match ? Number(match[1]) : undefined
}

/**
 * Probes the file size with HEAD and, when it exceeds `MAX_PREVIEW_BYTES`, fetches only the leading byte range.
 * Returns `undefined` when the file fits within the cap, HEAD fails, or the server rejects the range request, so the
 * caller falls back to a normal download.
 */
export async function readBoundedFile(
  fetch: (url: string, init: RequestInit) => Promise<Response>,
  path: string,
  url: string,
  signal: AbortSignal,
  headers?: HeadersInit,
): Promise<FileContent | undefined> {
  const head = await fetchWithHeadersTimeout(fetch, url, { method: "HEAD", headers }, signal)

  if (!head.ok) return undefined

  const headSize = Number(head.headers.get("content-length"))

  if (!Number.isFinite(headSize) || headSize <= MAX_PREVIEW_BYTES) return undefined

  const rangeHeaders = new Headers(headers)
  rangeHeaders.set("Range", `bytes=0-${MAX_PREVIEW_BYTES - 1}`)

  const partial = await fetchWithHeadersTimeout(fetch, url, { method: "GET", headers: rangeHeaders }, signal)

  if (!partial.ok) return undefined

  const bytes = new Uint8Array(await partial.arrayBuffer())

  if (partial.status !== 206) return fileContentFromBytes(path, bytes)

  const rangeTotal = parseContentRangeTotal(partial.headers.get("content-range"))
  const truncated = rangeTotal !== undefined ? bytes.length < rangeTotal : bytes.length >= MAX_PREVIEW_BYTES
  const size = rangeTotal ?? (truncated ? Math.max(headSize, bytes.length) : bytes.length)

  return fileContentFromBytes(path, bytes, { size, truncated })
}

/** Text files never contain NUL; a NUL in the first 8 KiB marks an unknown binary. */
function isBinaryBytes(bytes: Uint8Array) {
  return bytes.subarray(0, 8192).includes(0)
}

/** Media above this stays a placeholder so the in-memory file cache stays bounded. */
export const MAX_MEDIA_BYTES = 256 * 1024 * 1024

export function fileContentFromBytes(
  path: string,
  bytes: Uint8Array,
  options?: { size?: number; truncated?: boolean },
): FileContent {
  const kind = artifactKind(path)
  const mimeType = artifactMime(path)
  const size = options?.size ?? bytes.length

  if (binaryKinds.has(kind)) {
    if (bytes.length > MAX_MEDIA_BYTES) return { type: "binary", content: "", size }

    return { type: "binary", content: "", bytes, mimeType }
  }

  // Unknown binaries keep no bytes: the viewer only shows a placeholder for them.
  if (kind === "text" && isBinaryBytes(bytes)) return { type: "binary", content: "", size }

  // `stream: true` drops an incomplete multi-byte UTF-8 sequence at the end of a range slice instead of emitting U+FFFD.
  const content = new TextDecoder().decode(bytes, options?.truncated ? { stream: true } : undefined)

  return {
    type: "text",
    content,
    mimeType,
    size,
    ...(options?.truncated ? { truncated: true } : undefined),
  }
}
