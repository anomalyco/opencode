import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { randomBytes, timingSafeEqual } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { OPENCODE_VERSION } from "../../version"

export type SingletonHttpBridge = {
  port: number
  close: () => Promise<void>
}

type Options = {
  readonly port: number
  readonly statePath: string
  readonly log?: (line: string) => void
}

// `~/.local/state/opencode/singleton.json` — { port, password }, mode 0600.
export function readOrCreateBridgeSecret(statePath: string, port: number): { password: string; reused: boolean } {
  const file = path.join(statePath, "singleton.json")
  try {
    const raw = fs.readFileSync(file, "utf8")
    const parsed = JSON.parse(raw) as { port?: number; url?: string; password?: string }
    // Persistent per port: reuse ours whenever it matches; never touch the shared service's credentials.
    if (parsed.port === port && parsed.password) {
      return { password: parsed.password, reused: true }
    }
  } catch {
    // fall through
  }
  const password = randomBytes(24).toString("base64url")
  writeBridgeRegistration(file, statePath, port, password)
  return { password, reused: false }
}

function writeBridgeRegistration(file: string, statePath: string, port: number, password: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        id: randomBytes(16).toString("hex"),
        version: OPENCODE_VERSION,
        url: `http://127.0.0.1:${port}`,
        port,
        pid: process.pid,
        password,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  )
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
    req.on("end", () => resolve(Buffer.concat(chunks)))
    req.on("error", reject)
  })
}

function basicAuthOk(req: IncomingMessage, password: string): boolean {
  const header = req.headers.authorization
  if (!header || !header.startsWith("Basic ")) return false
  const decoded = Buffer.from(header.slice(6), "base64").toString("utf8")
  const idx = decoded.indexOf(":")
  if (idx < 3) return false // must carry "opencode:<password>"
  const user = decoded.slice(0, idx)
  const pass = decoded.slice(idx + 1)
  if (user !== "opencode") return false
  const a = Buffer.from(pass)
  const b = Buffer.from(password)
  return a.length === b.length && timingSafeEqual(a, b)
}

function toWebRequest(req: IncomingMessage, body: Buffer, port: number, signal?: AbortSignal): Request {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`)
  const headers = new Headers()
  for (const [name, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) for (const v of value) headers.append(name, v)
    else if (value !== undefined) headers.set(name, value)
  }
  const method = (req.method ?? "GET").toUpperCase()
  const init: RequestInit = { method, headers, signal }
  if (body.length && !["GET", "HEAD"].includes(method)) {
    init.body = body as unknown as BodyInit
  }
  return new Request(url, init)
}

export async function startSingletonHttpBridge(
  host: { readonly fetch: typeof fetch },
  options: Options,
): Promise<SingletonHttpBridge> {
  const { port, statePath, log } = options
  const { password, reused } = readOrCreateBridgeSecret(statePath, port)
  const server = createServer((req, res) => {
    void handle(req, res).catch((error: unknown) => {
      log?.(`singleton-http: ${String(error)}`)
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json" })
      }
      res.end(JSON.stringify({ error: "singleton-http: internal error" }))
    })

    async function handle(req: IncomingMessage, res: ServerResponse) {
      if (req.url && req.url.endsWith(".well-known")) {
        // Parity with other OpenCode local services is not required; 404 it.
      }
      if (!basicAuthOk(req, password)) {
        res.writeHead(401, { "www-authenticate": 'Basic realm="opencode singleton"', "content-type": "text/plain" })
        res.end("opencode singleton requires Basic auth with username \"opencode\". See the password file at ~/.local/state/opencode/singleton.json\n")
        return
      }
      const body = await readBody(req)
      const abort = new AbortController()
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
      const cancelReader = () => { try { reader?.cancel().catch(() => {}) } catch { /* not opened yet */ } }
      req.on("close", () => { abort.abort(); cancelReader() })
      res.on("close", () => { abort.abort(); cancelReader() })
      const webReq = toWebRequest(req, body, port, abort.signal)
      const webRes = await host.fetch(webReq)
      const headers: Record<string, string> = {}
      webRes.headers.forEach((value, name) => {
        headers[name] = value
      })
      // Streaming-friendly: copy status and headers, then pipe without buffering.
      res.writeHead(webRes.status, headers)
      if (webRes.body === null) {
        res.end()
        return
      }
      reader = webRes.body.getReader()
      const flush = async (chunk: Uint8Array) => {
        const ok = res.write(chunk)
        if (!ok && !res.destroyed) {
          await new Promise((resolve) => res.once("drain", resolve))
        }
      }
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          await flush(value)
        }
      } catch {
        // aborted stream — client disconnected; nothing left to do
      } finally {
        try { await reader.cancel() } catch { /* already closed */ }
      }
      res.end()
    }
  })
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(port, "127.0.0.1", () => resolve())
  })
  log?.(`singleton-http: listening on 127.0.0.1:${port} (password: ${reused ? "from" : "new"} ~/.local/state/opencode/singleton.json)`)
  return {
    port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  }
}
