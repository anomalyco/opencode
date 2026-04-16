#!/usr/bin/env node
// Exec gateway — runs INSIDE a Vercel sandbox VM.
//
// Binds :3000 with:
//   GET  /health  → 200 "ok"
//   WS   /exec    → per-process execution channel (token-authed)
//
// Auth: first WebSocket frame MUST be {type:"auth", token:<GATEWAY_TOKEN>}.
// Wrong or missing auth closes with code 4401.
//
// Frame protocol (post-auth):
//   client → {type:"spawn", cmd, args, cwd?, env?}
//   client → {type:"stdin", data:<base64>}
//   client → {type:"stdin-close"}
//   client → {type:"kill",  signal?}
//   gateway → {type:"ready"|"stdout"|"stderr"|"exit"|"error", ...}
//
// Keepalive: native WebSocket ping every 25s; no pong within 55s → close.

const { WebSocketServer } = require("ws")
const http = require("node:http")
const { spawn } = require("node:child_process")

const PORT = 3000
const EXPECTED_TOKEN = process.env.GATEWAY_TOKEN ?? ""

if (!EXPECTED_TOKEN) {
  console.error("[gateway] GATEWAY_TOKEN env var is required")
  process.exit(2)
}

const KEEPALIVE_INTERVAL_MS = 25_000
const KEEPALIVE_GRACE_MS = 55_000

const httpServer = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "text/plain" })
    res.end("ok")
    return
  }
  res.writeHead(404)
  res.end()
})

const wss = new WebSocketServer({ server: httpServer, path: "/exec" })

const close = (socket, code, reason) => {
  try {
    socket.close(code, reason)
  } catch {}
}

wss.on("connection", (socket, req) => {
  console.log(`[gateway] connection from ${req.socket.remoteAddress}`)

  let authed = false
  let lastPong = Date.now()
  let proc = null

  socket.on("pong", () => {
    lastPong = Date.now()
  })

  const keepalive = setInterval(() => {
    if (Date.now() - lastPong > KEEPALIVE_GRACE_MS) {
      console.log("[gateway] keepalive grace exceeded — closing")
      close(socket, 1001, "keepalive timeout")
      return
    }
    try {
      socket.ping()
    } catch {}
  }, KEEPALIVE_INTERVAL_MS)

  const send = (obj) => {
    try {
      socket.send(JSON.stringify(obj))
    } catch (err) {
      console.error("[gateway] send failed:", err.message)
    }
  }

  socket.on("message", (raw) => {
    let msg
    try {
      msg = JSON.parse(raw.toString("utf8"))
    } catch (err) {
      send({ type: "error", message: `bad frame: ${err.message}` })
      return
    }

    if (!authed) {
      if (msg.type !== "auth" || msg.token !== EXPECTED_TOKEN) {
        console.log("[gateway] auth failed")
        close(socket, 4401, "auth required")
        return
      }
      authed = true
      send({ type: "auth-ok" })
      return
    }

    if (msg.type === "spawn") {
      if (proc) {
        send({ type: "error", message: "already spawned" })
        return
      }
      console.log(`[gateway] spawn ${msg.cmd} ${(msg.args || []).join(" ")}`)
      try {
        proc = spawn(msg.cmd, msg.args || [], {
          cwd: msg.cwd,
          env: { ...process.env, ...(msg.env || {}) },
          stdio: ["pipe", "pipe", "pipe"],
        })
      } catch (err) {
        send({ type: "error", message: `spawn failed: ${err.message}` })
        close(socket, 1011, "spawn failed")
        return
      }
      proc.stdout.on("data", (chunk) =>
        send({ type: "stdout", data: Buffer.from(chunk).toString("base64") }),
      )
      proc.stderr.on("data", (chunk) =>
        send({ type: "stderr", data: Buffer.from(chunk).toString("base64") }),
      )
      proc.on("error", (err) => {
        send({ type: "error", message: `proc error: ${err.message}` })
      })
      proc.on("exit", (code) => {
        console.log(`[gateway] proc exit ${code}`)
        send({ type: "exit", code })
        close(socket, 1000, "proc exit")
      })
      send({ type: "ready", pid: proc.pid })
      return
    }

    if (msg.type === "stdin") {
      if (!proc) {
        send({ type: "error", message: "no process" })
        return
      }
      const bytes = Buffer.from(msg.data, "base64")
      proc.stdin.write(bytes)
      return
    }

    if (msg.type === "stdin-close") {
      if (proc) proc.stdin.end()
      return
    }

    if (msg.type === "kill") {
      if (proc) proc.kill(msg.signal || "SIGTERM")
      return
    }

    send({ type: "error", message: `unknown type: ${msg.type}` })
  })

  socket.on("close", () => {
    console.log("[gateway] socket closed")
    clearInterval(keepalive)
    if (proc) {
      try {
        proc.kill()
      } catch {}
    }
  })
})

httpServer.listen(PORT, () => {
  console.log(`[gateway] listening on :${PORT} (GET /health, WS /exec)`)
})
