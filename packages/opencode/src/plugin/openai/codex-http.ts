import { ProviderError } from "@/provider/error"

export const CODEX_HEADER_TIMEOUT = 60_000
export const CODEX_CHUNK_TIMEOUT = 360_000
const MAX_EVENT_BYTES = 64 * 1024
const POLICY = { 502: [3, 3_000], 503: [3, 2_000], 504: [2, 3_000] } as const
const SSE_POLICY = [3, 2_000] as const

export interface CodexHTTPOptions {
  fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  sleep?: (ms: number, signal?: AbortSignal | null) => Promise<void>
  headerTimeout?: number
  chunkTimeout?: number
}

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export async function fetchCodexHTTP(input: RequestInfo | URL, init: RequestInit = {}, options: CodexHTTPOptions = {}) {
  const fetcher = options.fetch ?? globalThis.fetch
  const sleep = options.sleep ?? abortableSleep
  const counters = { network: 0, 502: 0, 503: 0, 504: 0, overload: 0, unavailable: 0 }
  while (true) {
    const result = await fetchAttempt(fetcher, input, init, options.headerTimeout ?? CODEX_HEADER_TIMEOUT)
    if (result.kind === "failure") {
      if (counters.network === 3) throw result.error
      counters.network++
      await sleep(3_000, init.signal ?? undefined)
      continue
    }
    const status = result.response.status
    const policy = status === 502 ? POLICY[502] : status === 503 ? POLICY[503] : status === 504 ? POLICY[504] : undefined
    const count = status === 502 ? counters[502] : status === 503 ? counters[503] : status === 504 ? counters[504] : 0
    if (policy && count < policy[0]) {
      if (status === 502) counters[502]++
      if (status === 503) counters[503]++
      if (status === 504) counters[504]++
      await bestEffortCancel(result.response.body)
      await sleep(policy[1], init.signal ?? undefined)
      continue
    }
    if (status < 200 || status >= 300) return result.response
    const inspected = await inspect(result.response, options.chunkTimeout ?? CODEX_CHUNK_TIMEOUT, init.signal ?? undefined)
    if (inspected.kind === "accepted" || inspected.kind === "malformed") return inspected.response
    const key = inspected.code === "server_is_overloaded" ? "overload" : "unavailable"
    if (counters[key] === SSE_POLICY[0]) return reconstructed(inspected.response, inspected.buffered, inspected.reader, options.chunkTimeout ?? CODEX_CHUNK_TIMEOUT, init.signal ?? undefined)
    counters[key]++
    void bestEffortCancel(inspected.reader)
    await sleep(SSE_POLICY[1], init.signal ?? undefined)
  }
}

async function fetchAttempt(fetcher: Fetcher, input: RequestInfo | URL, init: RequestInit, timeout: number) {
  const timer = new AbortController()
  const signal = init.signal ? AbortSignal.any([init.signal, timer.signal]) : timer.signal
  const id = setTimeout(() => timer.abort(new ProviderError.HeaderTimeoutError(timeout)), timeout)
  try {
    return { kind: "response" as const, response: await fetcher(input, { ...init, signal }) }
  } catch (error) {
    if (init.signal?.aborted) throw init.signal.reason ?? new DOMException("Aborted", "AbortError")
    return { kind: "failure" as const, error: timer.signal.reason instanceof Error ? timer.signal.reason : toError(error) }
  } finally {
    clearTimeout(id)
  }
}

async function inspect(response: Response, timeout: number, signal?: AbortSignal) {
  const contentType = response.headers.get("content-type") ?? ""
  if (!contentType.toLowerCase().includes("text/event-stream")) {
    let preview = ""
    let failure: Error | undefined
    try {
      if (response.body) preview = await readPreview(response.body, timeout, signal)
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? error
      failure = toError(error)
    }
    const headers = new Headers(response.headers)
    ;["content-length", "content-encoding", "content-type"].forEach((name) => headers.delete(name))
    const detail = failure ? `preview ${failure.message.toLowerCase()}` : preview
    return { kind: "malformed" as const, response: failingResponse(new ProviderError.ResponseStreamError(`Codex response was not SSE (${contentType || "unknown"}): ${detail}`), headers) }
  }
  if (!response.body) return { kind: "malformed" as const, response: failingResponse(new ProviderError.ResponseStreamError("Codex SSE body was empty"), response.headers) }
  const reader = response.body.getReader()
  const buffered: Uint8Array[] = []
  let bytes = new Uint8Array()
  while (true) {
    const part = await readWithTimeout(reader, timeout, signal)
    if (part.done) {
      void bestEffortCancel(reader)
      return { kind: "malformed" as const, response: failingResponse(new ProviderError.ResponseStreamError("Codex SSE ended before its first event"), response.headers) }
    }
    buffered.push(part.value)
    bytes = join([bytes, part.value])
    const end = eventEnd(bytes)
    if (end < 0) {
      if (bytes.byteLength > MAX_EVENT_BYTES) {
        void bestEffortCancel(reader)
        return { kind: "malformed" as const, response: failingResponse(new ProviderError.ResponseStreamError("Codex SSE first event exceeded 64 KiB"), response.headers) }
      }
      continue
    }
    if (end > MAX_EVENT_BYTES) {
      void bestEffortCancel(reader)
      return { kind: "malformed" as const, response: failingResponse(new ProviderError.ResponseStreamError("Codex SSE first event exceeded 64 KiB"), response.headers) }
    }
    const code = firstErrorCode(new TextDecoder().decode(bytes.slice(0, end)))
    if (code) return { kind: "retry" as const, response, buffered, reader, code }
    return { kind: "accepted" as const, response: new Response(reconstructedStream(buffered, reader, timeout, signal), { status: response.status, headers: response.headers }) }
  }
}

function eventEnd(bytes: Uint8Array) {
  for (let i = 1; i < bytes.length; i++) if (bytes[i - 1] === 10 && bytes[i] === 10) return i + 1
  for (let i = 3; i < bytes.length; i++) if (bytes[i - 3] === 13 && bytes[i - 2] === 10 && bytes[i - 1] === 13 && bytes[i] === 10) return i + 1
  return -1
}

function firstErrorCode(event: string) {
  const data = event.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n")
  try {
    const value: unknown = JSON.parse(data)
    if (typeof value !== "object" || value === null || !("type" in value) || value.type !== "error") return undefined
    const code = "code" in value ? value.code : "error" in value && typeof value.error === "object" && value.error !== null && "code" in value.error ? value.error.code : undefined
    return code === "server_is_overloaded" || code === "service_unavailable_error" ? code : undefined
  } catch {
    return undefined
  }
}

function reconstructed(response: Response, buffered: Uint8Array[], reader: ReadableStreamDefaultReader<Uint8Array>, timeout: number, signal?: AbortSignal) {
  return new Response(reconstructedStream(buffered, reader, timeout, signal), { status: response.status, headers: response.headers })
}

function reconstructedStream(buffered: Uint8Array[], reader: ReadableStreamDefaultReader<Uint8Array>, timeout: number, signal?: AbortSignal) {
  let bufferedPending = true
  let finished = false
  return new ReadableStream<Uint8Array>({
    start(controller) {
      buffered.forEach((chunk) => controller.enqueue(chunk))
    },
    async pull(controller) {
      if (bufferedPending) {
        if (controller.desiredSize === 0) return
        bufferedPending = false
      }
      if (finished) return
      try {
        const part = await readWithTimeout(reader, timeout, signal)
        if (part.done) { finished = true; controller.close(); return }
        controller.enqueue(part.value)
      } catch (error) {
        finished = true
        controller.error(error)
        await bestEffortCancel(reader)
      }
    },
    cancel() { finished = true; return bestEffortCancel(reader) },
  })
}

async function readWithTimeout(reader: ReadableStreamDefaultReader<Uint8Array>, timeout: number, signal?: AbortSignal) {
  if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError")
  let timer: ReturnType<typeof setTimeout> | undefined
  let abort: (() => void) | undefined
  const abortPromise = new Promise<never>((_, reject) => {
    abort = () => reject(signal?.reason ?? new DOMException("Aborted", "AbortError"))
    signal?.addEventListener("abort", abort, { once: true })
  })
  const timeoutPromise = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new ProviderError.ResponseStreamError("Codex SSE read timed out")), timeout) })
  try { return await Promise.race([reader.read(), abortPromise, timeoutPromise]) }
  catch (error) { void bestEffortCancel(reader); throw error }
  finally { if (timer) clearTimeout(timer); if (abort && signal) signal.removeEventListener("abort", abort) }
}

async function readPreview(body: ReadableStream<Uint8Array>, timeout: number, signal?: AbortSignal) {
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (size < 1024) {
      const part = await readWithTimeout(reader, timeout, signal)
      if (part.done) break
      chunks.push(part.value.slice(0, 1024 - size)); size += part.value.byteLength
    }
  } finally { void bestEffortCancel(reader) }
  return new TextDecoder().decode(join(chunks)).slice(0, 1024)
}

async function bestEffortCancel(value: ReadableStream<Uint8Array> | ReadableStreamDefaultReader<Uint8Array> | null | undefined) {
  if (!value) return
  try { await Promise.race([value.cancel(), Promise.resolve()]) } catch {}
}

function failingResponse(error: Error, headers: HeadersInit) {
  const normalized = new Headers(headers)
  ;["content-length", "content-encoding", "content-type"].forEach((name) => normalized.delete(name))
  return new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.error(error) } }), { status: 200, headers: normalized })
}
function join(chunks: Uint8Array[]) { const out = new Uint8Array(chunks.reduce((n, chunk) => n + chunk.byteLength, 0)); chunks.reduce((n, chunk) => (out.set(chunk, n), n + chunk.byteLength), 0); return out }
function toError(error: unknown) { return error instanceof Error ? error : new Error(String(error)) }
function abortableSleep(ms: number, signal?: AbortSignal | null) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new DOMException("Aborted", "AbortError"))
    let id: ReturnType<typeof setTimeout>
    const abort = () => {
      clearTimeout(id)
      signal?.removeEventListener("abort", abort)
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"))
    }
    id = setTimeout(() => {
      signal?.removeEventListener("abort", abort)
      resolve()
    }, ms)
    signal?.addEventListener("abort", abort, { once: true })
  })
}
