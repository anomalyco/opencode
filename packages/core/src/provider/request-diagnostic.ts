import { createHash, randomUUID } from "node:crypto"
import { mkdir, lstat, readdir, open, readFile } from "node:fs/promises"
import path from "node:path"
import { DSML_GUARD_MESSAGE, EMPTY_VETTING_LOOP_MESSAGE } from "../session/llm/dsml"

// A local SDK correlation header. It MUST be stripped before network dispatch,
// including when diagnostics are disabled or the registration no longer exists.
export const REQUEST_DIAGNOSTIC_HEADER = "x-opencode-private-request-diagnostic"
const BODY_LIMIT = 16 * 1024 * 1024
const MEMORY_LIMIT = 128 * 1024 * 1024
const SLOT_BYTES = 8 * 1024 * 1024 - 4096
const DEFAULT_DIR = "/home/jsimon/.local/state/opencode/dsml-requests"
type Provenance = { provider: string; model: string; sessionID: string; messageID: string }
type Candidate = Provenance & { body: Buffer; requestID: string; attempt: number; created: string }
type Entry = Provenance & {
  token: string
  status: string
  attempt: number
  pending: number
  successfulResponse: boolean
  body?: Buffer
  requestID?: string
  queued: boolean
}

export function createRequestDiagnostic(
  options: {
    enabled?: boolean
    directory?: string
    writer?: (candidate: Candidate) => Promise<void>
  } = {},
) {
  const enabled = options.enabled ?? process.env.OPENCODE_DSML_REQUEST_CAPTURE === "1"
  const directory = options.directory ?? DEFAULT_DIR
  const entries = new Map<string, Entry>()
  const queue: Candidate[] = []
  const accounting = { bytes: 0, slots: 0, running: false }
  const writer = options.writer ?? ((candidate: Candidate) => persist(directory, candidate))
  const releaseBody = (entry: Entry) => {
    if (entry.body) accounting.bytes -= entry.body.length
    entry.body = undefined
    entry.requestID = undefined
  }
  const drain = () => {
    if (accounting.running) return
    accounting.running = true
    // No filesystem work runs synchronously on the guard/response path.
    void Promise.resolve().then(async () => {
      while (queue.length) {
        const candidate = queue.shift()!
        await writer(candidate).catch(() => {})
        accounting.bytes -= candidate.body.length
        accounting.slots--
      }
      accounting.running = false
    })
  }
  const triggerEntry = (entry: Entry, event: { type: string; message?: string }) => {
    if (event.type !== "provider-error" || (event.message !== DSML_GUARD_MESSAGE && event.message !== EMPTY_VETTING_LOOP_MESSAGE)) return
    if (entry.queued || !entries.has(entry.token)) return
    if (!entry.body || !entry.requestID || entry.pending || entry.status !== "ready") {
      if (entry.status !== "ambiguous") entry.status = "uncorrelated"
      return
    }
    const candidate: Candidate = {
      provider: entry.provider,
      model: entry.model,
      sessionID: entry.sessionID,
      messageID: entry.messageID,
      body: entry.body,
      requestID: entry.requestID,
      attempt: entry.attempt,
      created: new Date().toISOString(),
    }
    entry.body = undefined
    entry.queued = true
    entry.status = "queued"
    queue.push(candidate)
    drain()
  }
  const closeEntry = (entry: Entry) => {
    if (!entries.delete(entry.token)) return
    releaseBody(entry)
    if (!entry.queued) accounting.slots--
  }
  const prepare = (init: RequestInit = {}, input?: Request | string | URL) => {
    const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined))
    const token = headers.get(REQUEST_DIAGNOSTIC_HEADER)
    if (!token) return { init, settle: (_response?: Response) => {} }
    headers.delete(REQUEST_DIAGNOSTIC_HEADER)
    const clean = { ...init, headers }
    const entry = entries.get(token)
    if (!enabled || !entry || entry.queued) return { init: clean, settle: (_response?: Response) => {} }
    // Overlapping attempts cannot be paired confidently. Skip the entire handle.
    if (entry.pending || entry.successfulResponse || entry.status === "ambiguous") {
      releaseBody(entry)
      entry.status = "ambiguous"
      return { init: clean, settle: (_response?: Response) => {} }
    }
    releaseBody(entry)
    entry.attempt++
    if (typeof init.body !== "string") {
      entry.status = "unsupported_body"
      return { init: clean, settle: (_response?: Response) => {} }
    }
    const size = Buffer.byteLength(init.body)
    if (size > BODY_LIMIT || accounting.bytes + size > MEMORY_LIMIT) {
      entry.status = "capacity"
      return { init: clean, settle: (_response?: Response) => {} }
    }
    entry.body = Buffer.from(init.body)
    accounting.bytes += size
    entry.pending++
    entry.status = "pending"
    const attempt = entry.attempt
    return {
      init: clean,
      settle(response?: Response) {
        if (!entries.has(token) || entry.attempt !== attempt) return
        entry.pending = 0
        if (entry.status === "ambiguous") return
        entry.successfulResponse = response?.ok === true
        const requestID = response?.ok ? response.headers.get("x-llmgw-request-id") : undefined
        if (!requestID || !/^[a-f0-9]{16}$/.test(requestID)) {
          releaseBody(entry)
          entry.status = "uncorrelated"
          return
        }
        entry.requestID = requestID
        entry.status = "ready"
      },
    }
  }
  return {
    notice: enabled ? "enabled" : "disabled",
    stats: () => ({ ...accounting, handles: entries.size, queued: queue.length }),
    trigger(token: string, event: { type: string; message?: string }) {
      const entry = entries.get(token)
      if (entry) triggerEntry(entry, event)
    },
    close(token: string) {
      const entry = entries.get(token)
      if (entry) closeEntry(entry)
    },
    begin(provenance: Provenance) {
      if (!enabled) return undefined
      if (provenance.provider !== "llmgw" || provenance.model !== "dsv4") return undefined
      if (accounting.slots >= 8 || entries.size >= 8) return undefined
      const entry: Entry = {
        ...provenance,
        token: randomUUID(),
        status: "waiting",
        attempt: 0,
        pending: 0,
        successfulResponse: false,
        queued: false,
      }
      entries.set(entry.token, entry)
      accounting.slots++
      return {
        token: entry.token,
        status: () => entry.status,
        trigger: (event: { type: string; message?: string }) => triggerEntry(entry, event),
        close: () => closeEntry(entry),
      }
    },
    prepare,
    async prepareRequest(request: Request) {
      const headers = new Headers(request.headers)
      const token = headers.get(REQUEST_DIAGNOSTIC_HEADER)
      if (!token) return { request, settle: (_response?: Response) => {} }
      const body = request.body ? await request.clone().text() : undefined
      const prepared = prepare({ headers, body })
      return { request: new Request(request, prepared.init), settle: prepared.settle }
    },
  }
}

async function persist(directory: string, candidate: Candidate) {
  if (!path.isAbsolute(directory)) throw new Error("diagnostic directory must be absolute")
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const stat = await lstat(directory)
  if (!stat.isDirectory() || (stat.mode & 0o777) !== 0o700) throw new Error("diagnostic directory must be private")
  const files = await readdir(directory)
  if (files.length > 128 || files.some((name) => !/^slot-\d\d$|^[a-f0-9-]+\.(body|json)$/.test(name))) {
    throw new Error("diagnostic directory capacity or unknown files")
  }
  const sizes = await Promise.all(
    files.map(async (name) => {
      const info = await lstat(path.join(directory, name))
      if (!info.isFile() || (info.mode & 0o777) !== 0o600) throw new Error("diagnostic file must be private")
      return { name, bytes: info.size }
    }),
  )
  if (
    sizes.some((file) => file.name.startsWith("slot-") && (file.bytes !== 0 || Number(file.name.slice(5)) >= 32)) ||
    sizes.some((file) => file.name.endsWith(".json") && !files.includes(file.name.replace(/\.json$/, ".body")))
  ) {
    throw new Error("diagnostic unreserved data")
  }
  const bodyFiles = sizes.filter((file) => file.name.endsWith(".body"))
  const existingBytes = sizes.reduce((sum, file) => sum + file.bytes, 0)
  if (bodyFiles.length >= 32 || existingBytes + candidate.body.length + 4096 > 256 * 1024 * 1024) {
    throw new Error("diagnostic disk capacity")
  }
  // Refuse unreserved/orphan data, including externally placed allowed-name
  // files. An interrupted writer may conservatively prevent later captures.
  const claimed = new Set<number>()
  for (const file of bodyFiles) {
    const metaName = file.name.replace(/\.body$/, ".json")
    const metaInfo = sizes.find((item) => item.name === metaName)
    if (!metaInfo || metaInfo.bytes > 4096) throw new Error("diagnostic unreserved data")
    const meta = JSON.parse(await readFile(path.join(directory, metaName), "utf8")) as { reservations?: unknown }
    if (!Array.isArray(meta.reservations) || meta.reservations.length === 0)
      throw new Error("diagnostic unreserved data")
    for (const block of meta.reservations) {
      if (
        typeof block !== "number" ||
        !Number.isInteger(block) ||
        block < 0 ||
        block >= 32 ||
        claimed.has(block) ||
        !files.includes(`slot-${String(block).padStart(2, "0")}`)
      )
        throw new Error("diagnostic invalid reservation")
      claimed.add(block)
    }
    if (file.bytes + metaInfo.bytes > meta.reservations.length * SLOT_BYTES)
      throw new Error("diagnostic reservation overflow")
  }
  // Immutable reservations bound independent client processes without lock
  // deletion. Failed/crashed writes retain their reservations conservatively.
  const blocks = Math.ceil((candidate.body.length + 4096) / SLOT_BYTES)
  const reserved: number[] = []
  for (const index of Array.from({ length: 32 }, (_, index) => index)) {
    if (reserved.length === blocks) break
    const fd = await open(path.join(directory, `slot-${String(index).padStart(2, "0")}`), "wx", 0o600).catch(
      () => undefined,
    )
    if (!fd) continue
    await fd.close()
    reserved.push(index)
  }
  if (reserved.length !== blocks) throw new Error("diagnostic disk capacity")
  const name = randomUUID()
  const metadata = {
    exactness: "client-serialized-request-before-gateway-rewrites",
    sensitivity: "full request prompts and tool definitions; may include user-supplied secrets",
    source: "opencode-request-diagnostic-v1-20261005",
    provider: candidate.provider,
    model: candidate.model,
    session_id: candidate.sessionID,
    message_id: candidate.messageID,
    gateway_request_id: candidate.requestID,
    attempt: candidate.attempt,
    created_at: candidate.created,
    bytes: candidate.body.length,
    sha256: createHash("sha256").update(candidate.body).digest("hex"),
    body_file: `${name}.body`,
    reservations: reserved,
  }
  const serialized = JSON.stringify(metadata)
  if (Buffer.byteLength(serialized) > 4096) throw new Error("diagnostic metadata capacity")
  const body = await open(path.join(directory, `${name}.body`), "wx", 0o600)
  try {
    await body.writeFile(candidate.body)
  } finally {
    await body.close()
  }
  const meta = await open(path.join(directory, `${name}.json`), "wx", 0o600)
  try {
    await meta.writeFile(serialized)
  } finally {
    await meta.close()
  }
}

export const RequestDiagnostic = createRequestDiagnostic()
