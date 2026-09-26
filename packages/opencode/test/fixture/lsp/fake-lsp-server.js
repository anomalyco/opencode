// Simple JSON-RPC 2.0 LSP-like fake server over stdio

let nextId = 1
let readBuffer = Buffer.alloc(0)
let lastChange = null
let initializeParams = null
let diagnosticRequestCount = 0
let registeredCapability = false
const fs = require("fs")
const shutdownMode = process.env.OPENCODE_TEST_LSP_SHUTDOWN
const eventFile = process.env.OPENCODE_TEST_LSP_EVENT_FILE
const shutdownReleaseFile = process.env.OPENCODE_TEST_LSP_SHUTDOWN_RELEASE_FILE
const initializeReleaseFile = process.env.OPENCODE_TEST_LSP_INITIALIZE_RELEASE_FILE
const recordInitialize = process.env.OPENCODE_TEST_LSP_RECORD_INITIALIZE
const recordStart = process.env.OPENCODE_TEST_LSP_RECORD_START
const descendantEventFile = process.env.OPENCODE_TEST_LSP_DESCENDANT_EVENT_FILE
const descendantPidFile = process.env.OPENCODE_TEST_LSP_DESCENDANT_PID_FILE
const descendantExpiryMs = Number(process.env.OPENCODE_TEST_LSP_DESCENDANT_EXPIRY_MS ?? 10_000)
const pendingClientRequests = new Map()
let pullConfig = {
  delayMs: 0,
  registerOn: undefined,
  registrations: [],
  documentDiagnostics: [],
  documentDiagnosticsByIdentifier: {},
  documentDelayMsByIdentifier: {},
  workspaceDiagnostics: [],
  workspaceDiagnosticsByIdentifier: {},
  workspaceDelayMsByIdentifier: {},
}

function encode(message) {
  const json = JSON.stringify(message)
  const header = `Content-Length: ${Buffer.byteLength(json, "utf8")}\r\n\r\n`
  return Buffer.concat([Buffer.from(header, "utf8"), Buffer.from(json, "utf8")])
}

function decodeFrames(buffer) {
  const results = []
  let idx
  while ((idx = buffer.indexOf("\r\n\r\n")) !== -1) {
    const header = buffer.slice(0, idx).toString("utf8")
    const match = /Content-Length:\s*(\d+)/i.exec(header)
    const length = match ? parseInt(match[1], 10) : 0
    const bodyStart = idx + 4
    const bodyEnd = bodyStart + length
    if (buffer.length < bodyEnd) break
    results.push(buffer.slice(bodyStart, bodyEnd).toString("utf8"))
    buffer = buffer.slice(bodyEnd)
  }
  return { messages: results, rest: buffer }
}

function send(message) {
  process.stdout.write(encode(message))
}

function sendRequest(method, params) {
  const id = nextId++
  send({ jsonrpc: "2.0", id, method, params })
  return id
}

function sendResponse(id, result) {
  send({ jsonrpc: "2.0", id, result })
}

function sendNotification(method, params) {
  send({ jsonrpc: "2.0", method, params })
}

function record(event) {
  if (!eventFile) return
  fs.appendFileSync(eventFile, `${event}\n`)
}

if (recordStart) record("start")

if (descendantEventFile || descendantPidFile) {
  const { spawn } = require("child_process")
  spawn(
    process.execPath,
    [
      "-e",
      `
    const fs = require("fs")
    const http = require("http")
    const eventFile = ${JSON.stringify(descendantEventFile)}
    const pidFile = ${JSON.stringify(descendantPidFile)}
    const expiryMs = ${JSON.stringify(descendantExpiryMs)}
    const server = http.createServer((_, response) => response.end("alive"))
    const close = () => server.close(() => process.exit(0))
    process.on("SIGTERM", () => {
      if (eventFile) fs.appendFileSync(eventFile, "descendant-exit\\n")
      close()
    })
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (!address || typeof address === "string") process.exit(1)
      if (eventFile) fs.appendFileSync(eventFile, "descendant-start\\n")
      if (pidFile) fs.writeFileSync(pidFile, process.pid + "\\nhttp://127.0.0.1:" + address.port)
      setTimeout(close, Math.max(expiryMs, 1))
    })
  `,
    ],
    { stdio: "ignore" },
  )
}

if (shutdownMode === "unresponsive") setInterval(() => {}, 1_000)

function maybeRegister(method) {
  if (pullConfig.registerOn !== method || registeredCapability) return
  registeredCapability = true
  sendRequest("client/registerCapability", {
    registrations: pullConfig.registrations.map((registration, index) => ({
      id: registration.id ?? `pull-${index}`,
      method: registration.method ?? "textDocument/diagnostic",
      registerOptions: registration.registerOptions ?? registration,
    })),
  })
}

function delayed(id, result, delayMs = pullConfig.delayMs) {
  if (!delayMs) {
    sendResponse(id, result)
    return
  }
  setTimeout(() => sendResponse(id, result), delayMs)
}

function diagnosticsForIdentifier(identifier) {
  return pullConfig.documentDiagnosticsByIdentifier[identifier] ?? pullConfig.documentDiagnostics
}

function workspaceDiagnosticsForIdentifier(identifier) {
  return pullConfig.workspaceDiagnosticsByIdentifier[identifier] ?? pullConfig.workspaceDiagnostics
}

function documentDelayForIdentifier(identifier) {
  return pullConfig.documentDelayMsByIdentifier[identifier] ?? pullConfig.delayMs
}

function workspaceDelayForIdentifier(identifier) {
  return pullConfig.workspaceDelayMsByIdentifier[identifier] ?? pullConfig.delayMs
}

function handle(raw) {
  let data
  try {
    data = JSON.parse(raw)
  } catch {
    return
  }

  if (typeof data.method === "undefined" && typeof data.id !== "undefined") {
    const pending = pendingClientRequests.get(data.id)
    if (!pending) return
    pendingClientRequests.delete(data.id)
    sendResponse(pending, data.result ?? null)
    return
  }

  if (data.method === "initialize") {
    initializeParams = data.params
    if (recordInitialize) record("initialize")
    const response = () =>
      sendResponse(data.id, {
        capabilities: {
          textDocumentSync: {
            change: 2,
          },
        },
      })
    if (!initializeReleaseFile) {
      response()
      return
    }
    const timer = setInterval(() => {
      if (!fs.existsSync(initializeReleaseFile)) return
      clearInterval(timer)
      response()
    }, 10)
    return
  }

  if (data.method === "shutdown") {
    record("shutdown")
    if (shutdownMode === "unresponsive") return
    const response = () => {
      sendResponse(data.id, null)
      record("shutdown-response")
    }
    if (shutdownReleaseFile) {
      const timer = setInterval(() => {
        if (!fs.existsSync(shutdownReleaseFile)) return
        clearInterval(timer)
        response()
      }, 10)
      return
    }
    response()
    return
  }

  if (data.method === "exit") {
    record("exit")
    if (shutdownMode === "unresponsive") return
    process.exit(0)
  }

  if (data.method === "test/get-initialize-params") {
    sendResponse(data.id, initializeParams)
    return
  }

  if (data.method === "test/request-configuration") {
    const id = sendRequest("workspace/configuration", data.params)
    pendingClientRequests.set(id, data.id)
    return
  }

  if (data.method === "initialized" || data.method === "workspace/didChangeConfiguration") {
    return
  }

  if (data.method === "textDocument/didOpen") {
    maybeRegister("didOpen")
    return
  }

  if (data.method === "textDocument/didChange") {
    lastChange = data.params
    maybeRegister("didChange")
    return
  }

  if (data.method === "test/trigger") {
    const method = data.params && data.params.method
    if (method === "client/registerCapability") {
      sendRequest(method, {
        registrations: [
          {
            id: "test-diagnostic-registration",
            method: "textDocument/diagnostic",
            registerOptions: { identifier: "syntax" },
          },
        ],
      })
      return
    }
    if (method === "client/unregisterCapability") {
      sendRequest(method, {
        unregisterations: [{ id: "test-diagnostic-registration", method: "textDocument/diagnostic" }],
      })
      return
    }
    if (method) sendRequest(method, {})
    return
  }

  if (data.method === "test/configure-pull-diagnostics") {
    pullConfig = {
      delayMs: data.params?.delayMs ?? 0,
      registerOn: data.params?.registerOn,
      registrations: data.params?.registrations ?? [],
      documentDiagnostics: data.params?.documentDiagnostics ?? [],
      documentDiagnosticsByIdentifier: data.params?.documentDiagnosticsByIdentifier ?? {},
      documentDelayMsByIdentifier: data.params?.documentDelayMsByIdentifier ?? {},
      workspaceDiagnostics: data.params?.workspaceDiagnostics ?? [],
      workspaceDiagnosticsByIdentifier: data.params?.workspaceDiagnosticsByIdentifier ?? {},
      workspaceDelayMsByIdentifier: data.params?.workspaceDelayMsByIdentifier ?? {},
    }
    registeredCapability = false
    sendResponse(data.id, null)
    return
  }

  if (data.method === "test/register-configured-pull-diagnostics") {
    maybeRegister(undefined)
    sendResponse(data.id, null)
    return
  }

  if (data.method === "test/publish-diagnostics") {
    sendNotification("textDocument/publishDiagnostics", data.params)
    return
  }

  if (data.method === "test/get-last-change") {
    sendResponse(data.id, lastChange)
    return
  }

  if (data.method === "test/get-diagnostic-request-count") {
    sendResponse(data.id, diagnosticRequestCount)
    return
  }

  if (data.method === "textDocument/diagnostic") {
    diagnosticRequestCount += 1
    delayed(
      data.id,
      {
        kind: "full",
        items: diagnosticsForIdentifier(data.params?.identifier ?? ""),
      },
      documentDelayForIdentifier(data.params?.identifier ?? ""),
    )
    return
  }

  if (data.method === "workspace/diagnostic") {
    diagnosticRequestCount += 1
    delayed(
      data.id,
      {
        items: workspaceDiagnosticsForIdentifier(data.params?.identifier ?? ""),
      },
      workspaceDelayForIdentifier(data.params?.identifier ?? ""),
    )
    return
  }

  if (typeof data.id !== "undefined") {
    sendResponse(data.id, null)
  }
}

process.stdin.on("data", (chunk) => {
  readBuffer = Buffer.concat([readBuffer, chunk])
  const { messages, rest } = decodeFrames(readBuffer)
  readBuffer = rest
  for (const message of messages) handle(message)
})
