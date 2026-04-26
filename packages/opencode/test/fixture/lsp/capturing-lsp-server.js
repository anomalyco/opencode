// Minimal fake LSP server that records the `initialize` params into the file
// referenced by OPENCODE_LSP_CAPTURE_FILE so tests can assert on the payload.

const fs = require("fs")

const captureFile = process.env.OPENCODE_LSP_CAPTURE_FILE

function encode(message) {
  const json = JSON.stringify(message)
  const header = `Content-Length: ${Buffer.byteLength(json, "utf8")}\r\n\r\n`
  return Buffer.concat([Buffer.from(header, "utf8"), Buffer.from(json, "utf8")])
}

function send(msg) {
  process.stdout.write(encode(msg))
}

function decodeFrames(buffer) {
  const results = []
  let idx
  while ((idx = buffer.indexOf("\r\n\r\n")) !== -1) {
    const header = buffer.slice(0, idx).toString("utf8")
    const m = /Content-Length:\s*(\d+)/i.exec(header)
    const len = m ? parseInt(m[1], 10) : 0
    const bodyStart = idx + 4
    const bodyEnd = bodyStart + len
    if (buffer.length < bodyEnd) break
    const body = buffer.slice(bodyStart, bodyEnd).toString("utf8")
    results.push(body)
    buffer = buffer.slice(bodyEnd)
  }
  return { messages: results, rest: buffer }
}

let readBuffer = Buffer.alloc(0)

process.stdin.on("data", (chunk) => {
  readBuffer = Buffer.concat([readBuffer, chunk])
  const { messages, rest } = decodeFrames(readBuffer)
  readBuffer = rest
  for (const m of messages) handle(m)
})

function handle(raw) {
  let data
  try {
    data = JSON.parse(raw)
  } catch {
    return
  }
  if (data.method === "initialize") {
    if (captureFile) {
      try {
        fs.writeFileSync(captureFile, JSON.stringify(data.params ?? {}))
      } catch {}
    }
    send({ jsonrpc: "2.0", id: data.id, result: { capabilities: {} } })
    return
  }
  if (typeof data.id !== "undefined") {
    send({ jsonrpc: "2.0", id: data.id, result: null })
    return
  }
}
