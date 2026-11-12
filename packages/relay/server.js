#!/usr/bin/env node
/**
 * OpenCode Relay — Control Plane
 *
 * Responsibilities:
 *   1. Account system: register / login / session tokens
 *   2. Environment registry: register 'opencode server on Mac' as a discoverable Environment
 *   3. App access layer: expose an API shape that OpenCode Mobile recognizes
 *
 * Key design:
 *   - relay only handles 'accounts + discovery', it does not proxy opencode business traffic.
 *     Traffic flows through the OpenTunnel tunnel (blind TLS, relay cannot see plaintext).
 *   - Environment url points to the tunnel entry; App connects directly using Basic Auth.
 *   - relay and coordinator are co-located but run as separate processes on separate ports.
 */

import http from 'node:http'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { URL } from 'node:url'
import { WebSocketServer, WebSocket } from 'ws'

const PORT = Number(process.env.RELAY_PORT || 9999)
const HOST = process.env.RELAY_HOST || '127.0.0.1'
const DATA_DIR = process.env.RELAY_DATA_DIR || '/opt/oc-relay/data'
const DB_FILE = path.join(DATA_DIR, 'relay.json')
const TRUST_PROXY = process.env.RELAY_TRUST_PROXY === '1'
const PUBLIC_BASE = process.env.RELAY_PUBLIC_BASE || ''

// Session expires after 24 hours of inactivity; stale sessions are purged periodically.
const SESSION_TTL_MS = Number(process.env.RELAY_SESSION_TTL_MS || 24 * 60 * 60 * 1000)
const SESSION_CLEANUP_INTERVAL_MS = Number(process.env.RELAY_SESSION_CLEANUP_MS || 10 * 60 * 1000)

// Rate limiting: max failed login/register attempts per IP within the window.
const RATE_LIMIT_WINDOW_MS = Number(process.env.RELAY_RATE_LIMIT_WINDOW_MS || 60 * 1000)
const RATE_LIMIT_MAX_ATTEMPTS = Number(process.env.RELAY_RATE_LIMIT_MAX || 10)

// ── Storage ────────────────────────────────────────────────────────────────
// Single-file JSON storage. The data volume is 'a few accounts + a few machines', no need for a database.
// Writes use 'write temp file then rename' for atomicity, avoiding partial files on power loss.

const db = load()

function load() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'))
  } catch {
    return { users: {}, environments: {}, sessions: {} }
  }
}

function save() {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  const tmp = DB_FILE + '.' + process.pid + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), { mode: 0o600 })
  fs.renameSync(tmp, DB_FILE)
}

// ── Password and token ──────────────────────────────────────────────────

function hashPassword(password, salt) {
  const s = salt || crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(password, s, 64, { N: 16384, r: 8, p: 1 }).toString('hex')
  return { salt: s, hash }
}

function verifyPassword(password, salt, expected) {
  const actual = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 })
  const want = Buffer.from(expected, 'hex')
  return actual.length === want.length && crypto.timingSafeEqual(actual, want)
}

function newToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url')
}

function id(prefix) {
  return prefix + '_' + crypto.randomBytes(9).toString('base64url')
}

// ── HTTP helpers ───────────────────────────────────────────────────────────

function json(res, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...extraHeaders,
  })
  res.end(payload)
}

async function readBody(req, limit = 1_000_000) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new Error('payload too large')
    chunks.push(chunk)
  }
  if (!chunks.length) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new Error('invalid JSON')
  }
}

function bearer(req) {
  const header = req.headers.authorization || ''
  if (header.toLowerCase().startsWith('bearer ')) return header.slice(7).trim()
  return null
}

// Node exposes a repeated header as an array; the tunnel protocol carries one
// string per header name, so join the values the way HTTP does.
function headerValue(value) {
  return Array.isArray(value) ? value.join(', ') : String(value ?? '')
}

// Copy the headers that may be forwarded, dropping the ones that must not be.
function forwardHeaders(source, blocked) {
  const headers = {}
  for (const [key, value] of Object.entries(source)) {
    if (blocked.includes(key.toLowerCase())) continue
    if (value === undefined) continue
    headers[key] = headerValue(value)
  }
  return headers
}

// ── Rate limiter ─────────────────────────────────────────────────────────
// Simple in-memory sliding-window rate limiter per IP address.
// Suitable for a relay with a small number of users; resets on restart.

const rateBuckets = new Map() // ip -> { count, windowStart }

function rateLimitCheck(ip) {
  const now = Date.now()
  let bucket = rateBuckets.get(ip)
  if (!bucket || now - bucket.windowStart > RATE_LIMIT_WINDOW_MS) {
    bucket = { count: 0, windowStart: now }
    rateBuckets.set(ip, bucket)
  }
  bucket.count++
  return bucket.count <= RATE_LIMIT_MAX_ATTEMPTS
}

function rateLimitRemaining(ip) {
  const bucket = rateBuckets.get(ip)
  if (!bucket) return RATE_LIMIT_MAX_ATTEMPTS
  return Math.max(0, RATE_LIMIT_MAX_ATTEMPTS - bucket.count)
}

// ── WebSocket reverse tunnel ────────────────────────────────────────────
//
// The server (desktop's built-in share module) makes an outbound connection to relay's
// /api/tunnel/:envId, establishing a persistent WebSocket. relay forwards client
// HTTP requests to /api/proxy/:envId/* through this WebSocket to the server,
// which forwards them to the local opencode; responses travel back along the WebSocket.
//
// This way relay no longer depends on the opentunnel coordinator tunnel, and the server
// needs no public ingress or self-signed CA — a single outbound WebSocket is the tunnel.
//
// Message protocol (JSON, binary uses base64):
//   relay -> server:
//     { type:'req', id, method, path, headers, body? }   HTTP request
//     { type:'ws-data', id, data }                        terminal session bidirectional data
//     { type:'ws-close', id }
//   server -> relay:
//     { type:'res', id, status, headers }                 response headers
//     { type:'chunk', id, data }                          response body chunks (can be multiple)
//     { type:'end', id }                                  response end
//     { type:'ws-open', id }                              terminal session upgrade success
//     { type:'ws-data', id, data }
//     { type:'ws-close', id }

const tunnels = new Map() // envId -> { ws, lastSeenAt }
const pending = new Map() // reqId -> { res, method, headersSent, status, headers, timer }
const clientTerminals = new Map() // reqId -> { ws, envId } — client side of a terminal session

async function readRawBody(req, limit = 32 * 1024 * 1024) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new Error('payload too large')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

// These upstream response headers must not be passed through to the client as-is:
//   content-encoding/transfer-encoding/content-length — semantics change after tunnel forwarding
//   access-control-* / vary — CORS is controlled uniformly by relay
function filterUpstreamHeaders(headers) {
  const out = {}
  for (const [key, value] of Object.entries(headers || {})) {
    const lower = key.toLowerCase()
    if (['content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(lower)) continue
    if (lower.startsWith('access-control-') || lower === 'vary') continue
    out[key] = value
  }
  return out
}

// ── V2 binary frame protocol ────────────────────────────────────────────
//
// V1 protocol: all messages are JSON text frames, binary data is base64-encoded.
// V2 protocol: metadata uses JSON text frames, binary data (request body / response body) uses WebSocket binary frames.
//
// Text frames (JSON metadata):
//   relay→desktop: { t:1, id, method, path, headers }    request start
//   relay→desktop: { t:2, id }                            request body end
//   desktop→relay: { t:3, id, status, headers }            response headers
//   desktop→relay: { t:4, id }                            response end
//
// Binary frames (raw bytes, no base64):
//   Format: [idLen:2-byte BE][id string][raw data bytes]
//   relay→desktop: request body chunks
//   desktop→relay: response body chunks (SSE per-token passthrough)
//
// Protocol negotiation: desktop sends Sec-WebSocket-Protocol: oc-tunnel-v2 during WebSocket handshake.
// relay checks ws.protocol to determine whether to use V2 or fall back to V1.

const V2_PROTOCOL = 'oc-tunnel-v2'
const BACKPRESSURE_LIMIT = 2 * 1024 * 1024 // 2MB

function packBinaryFrame(reqId, data) {
  const idBuf = Buffer.from(reqId, 'utf8')
  const header = Buffer.alloc(2)
  header.writeUInt16BE(idBuf.length, 0)
  return Buffer.concat([header, idBuf, data])
}

function unpackBinaryFrame(raw) {
  const idLen = raw.readUInt16BE(0)
  const reqId = raw.subarray(2, 2 + idLen).toString('utf8')
  const data = raw.subarray(2 + idLen)
  return { id: reqId, data }
}

function isV2Tunnel(tunnel) {
  return tunnel && tunnel.protocol === V2_PROTOCOL
}

// Backpressure-aware send: returns false when buffer exceeds threshold, caller should pause reading
function safeSend(ws, data, binary = false) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return false
  if (ws.bufferedAmount > BACKPRESSURE_LIMIT) return false
  ws.send(data, { binary })
  return true
}

// Process messages received from the server via the tunnel, routing to the corresponding pending request or terminal session.
function handleTunnelMessage(ws, raw) {
  let msg
  try {
    msg = JSON.parse(raw.toString())
  } catch {
    return
  }
  if (!msg || typeof msg.id !== 'string') return

  // Terminal session (WebSocket upgrade) messages, routed to the client WebSocket.
  if (msg.type === 'ws-open' || msg.type === 'ws-data' || msg.type === 'ws-close') {
    const terminal = clientTerminals.get(msg.id)
    if (!terminal) return

    if (msg.type === 'ws-open') return // Client WebSocket already established, no additional action needed
    if (msg.type === 'ws-data') {
      terminal.ws.send(Buffer.from(msg.data || '', 'base64'))
      return
    }
    // ws-close
    clientTerminals.delete(msg.id)
    terminal.ws.close()
    return
  }

  const entry = pending.get(msg.id)
  if (!entry) return

  // V2 text frame: response headers (t:3)
  if (msg.t === 3) {
    entry.status = msg.status
    entry.headers = filterUpstreamHeaders(msg.headers)
    if (entry.method === 'HEAD') {
      entry.res.writeHead(msg.status, entry.headers)
      entry.res.end()
      pending.delete(msg.id)
      clearTimeout(entry.timer)
      return
    }
    // Only writeHead if headers haven't sent yet (binary frame may have triggered auto-send)
    if (!entry.headersSent) {
      entry.res.writeHead(msg.status, entry.headers)
      entry.headersSent = true
    }
    return
  }

  // V2 text frame: response end (t:4)
  if (msg.t === 4) {
    if (!entry.headersSent) {
      entry.res.writeHead(entry.status || 502, entry.headers || {})
      entry.headersSent = true
    }
    entry.res.end()
    pending.delete(msg.id)
    clearTimeout(entry.timer)
    return
  }

  // V1 compat: response headers (type:'res')
  if (msg.type === 'res') {
    entry.status = msg.status
    entry.headers = filterUpstreamHeaders(msg.headers)
    if (entry.method === 'HEAD') {
      entry.res.writeHead(msg.status, entry.headers)
      entry.res.end()
      pending.delete(msg.id)
      clearTimeout(entry.timer)
      return
    }
    if (!entry.headersSent) {
      entry.res.writeHead(msg.status, entry.headers)
      entry.headersSent = true
    }
    return
  }

  // V1 compat: response body chunk (type:'chunk')
  if (msg.type === 'chunk') {
    if (!entry.headersSent) {
      entry.res.writeHead(entry.status || 502, entry.headers || {})
      entry.headersSent = true
    }
    entry.res.write(Buffer.from(msg.data || '', 'base64'))
    return
  }

  // V1 compat: response end (type:'end')
  if (msg.type === 'end') {
    if (!entry.headersSent) {
      entry.res.writeHead(entry.status || 502, entry.headers || {})
      entry.headersSent = true
    }
    entry.res.end()
    pending.delete(msg.id)
    clearTimeout(entry.timer)
    return
  }
}

// Forward a regular HTTP request through the tunnel (including streaming responses).
async function tunnelProxy(envId, req, res, pathWithQuery, headers) {
  const tunnel = tunnels.get(envId)
  if (!tunnel || tunnel.ws.readyState !== WebSocket.OPEN) {
    return json(res, 502, { error: 'no active tunnel for environment' })
  }

  const reqId = id('req')
  const method = req.method
  const v2 = isV2Tunnel(tunnel)

  const entry = {
    res,
    method,
    headersSent: false,
    status: undefined,
    headers: undefined,
    timer: null,
  }
  pending.set(reqId, entry)
  entry.timer = setTimeout(() => {
    if (!pending.has(reqId)) return
    pending.delete(reqId)
    if (!entry.headersSent) json(res, 504, { error: 'tunnel timeout' })
    else res.end()
  }, 30 * 60 * 1000)

  if (v2) {
    // ── V2: binary frame protocol, request body streamed ──
    // Metadata as JSON text frames, request body as binary frames (no base64)
    tunnel.ws.send(JSON.stringify({
      t: 1, id: reqId, method, path: pathWithQuery, headers,
    }))

    // Stream request body (chunked, no need to wait for complete body)
    if (!['GET', 'HEAD'].includes(method)) {
      req.on('data', (chunk) => {
        safeSend(tunnel.ws, packBinaryFrame(reqId, chunk), true)
      })
      req.on('end', () => {
        tunnel.ws.send(JSON.stringify({ t: 2, id: reqId }))
      })
      req.on('error', () => {
        if (pending.has(reqId)) {
          pending.delete(reqId)
          clearTimeout(entry.timer)
          if (!entry.headersSent) json(res, 502, { error: 'request body read error' })
          else res.end()
        }
      })
    } else {
      tunnel.ws.send(JSON.stringify({ t: 2, id: reqId }))
    }
  } else {
    // ── V1: compatible with older desktop (JSON+base64) ──
    let body = null
    if (!['GET', 'HEAD'].includes(method)) {
      body = await readRawBody(req)
    }

    tunnel.ws.send(
      JSON.stringify({
        type: 'req',
        id: reqId,
        method,
        path: pathWithQuery,
        headers,
        ...(body && body.length ? { body: body.toString('base64') } : {}),
      }),
      (err) => {
        if (!err) return
        if (!pending.has(reqId)) return
        pending.delete(reqId)
        clearTimeout(entry.timer)
        if (!entry.headersSent) json(res, 502, { error: 'tunnel send failed', detail: String(err.message || err) })
      },
    )
  }
}

// Terminal session WebSocket upgrades are handled in the server's `upgrade` event (see attachTunnelServer),
// not the HTTP `request` event — Node does not emit `request` for upgrade requests.

// The server (desktop share module) establishes a reverse tunnel. Validates Bearer token and envId ownership.
// Routes WebSocket upgrade requests from clients to the correct handler.
//
// Two types of WebSocket:
//   1. Reverse tunnel from server (desktop share module): /api/tunnel/:envId
//   2. Client terminal sessions: /api/proxy/:envId/... (relay forwards through tunnel to server)
function attachTunnelServer(server) {
  const tunnelWss = new WebSocketServer({ noServer: true })
  const clientWss = new WebSocketServer({ noServer: true })

  server.on('upgrade', (req, socket, head) => {
    const pathname = new URL(req.url, 'http://localhost').pathname

    if (/^\/api\/tunnel\/[^/]+$/.test(pathname)) {
      tunnelWss.handleUpgrade(req, socket, head, (ws) => tunnelWss.emit('connection', ws, req))
      return
    }

    if (/^\/api\/proxy\/[^/]+/.test(pathname)) {
      clientWss.handleUpgrade(req, socket, head, (ws) => clientWss.emit('connection', ws, req))
      return
    }

    socket.destroy()
  })

  // ── Server reverse tunnel ────────────────────────────────────────────
  tunnelWss.on('connection', (ws, request) => {
    const pathname = new URL(request.url, 'http://localhost').pathname
    const m = pathname.match(/^\/api\/tunnel\/([^/]+)$/)
    if (!m) {
      ws.close(4000, 'bad tunnel path')
      return
    }
    const envId = decodeURIComponent(m[1])
    const env = findEnvironment(envId)
    if (!env) {
      ws.close(4004, 'unknown environment')
      return
    }

    // Auth: the user corresponding to the Bearer token must be the environment owner
    const token = request.headers.authorization?.toLowerCase().startsWith('bearer ')
      ? request.headers.authorization.slice(7).trim()
      : null
    const session = token ? db.sessions[token] : null
    const user = session ? db.users[session.userId] : null
    if (!user || user.id !== env.ownerId) {
      ws.close(4001, 'unauthorized')
      return
    }

    // Evict the old connection for the same environment, ensuring only one active tunnel.
    const old = tunnels.get(envId)
    if (old && old.ws !== ws && old.ws.readyState === WebSocket.OPEN) {
      old.ws.close(4009, 'superseded by a newer connection')
    }
    tunnels.set(envId, { ws, lastSeenAt: Date.now(), protocol: ws.protocol || '' })

    ws.on('message', (raw, isBinary) => {
      if (isBinary) {
        // V2 binary frame: raw response body bytes, written directly to HTTP response
        const { id, data } = unpackBinaryFrame(raw)
        const entry = pending.get(id)
        if (!entry) return
        if (!entry.headersSent) {
          entry.res.writeHead(entry.status || 502, entry.headers || {})
          entry.headersSent = true
        }
        entry.res.write(data) // Write raw bytes directly, no base64 decoding
        return
      }
      handleTunnelMessage(ws, raw)
    })
    ws.on('close', () => {
      if (tunnels.get(envId)?.ws === ws) tunnels.delete(envId)
    })
    ws.on('error', () => {
      if (tunnels.get(envId)?.ws === ws) tunnels.delete(envId)
    })
  })

  // ── Client terminal sessions ────────────────────────────────────────────
  clientWss.on('connection', (clientWs, request) => {
    const url = new URL(request.url, 'http://localhost')
    const m = url.pathname.match(/^\/api\/proxy\/([^/]+)(?:\/(.*))?$/)
    if (!m) {
      clientWs.close(4000, 'bad proxy path')
      return
    }

    const envId = decodeURIComponent(m[1])
    const env = findEnvironment(envId)
    if (!env) {
      clientWs.close(4004, 'unknown environment')
      return
    }

    // Auth: same as HTTP proxy, uses relay account (Bearer session or Basic).
    const user = sessionUser(request)?.user || basicUser(request, env.ownerId)
    if (!user || user.id !== env.ownerId) {
      clientWs.close(4001, 'unauthorized')
      return
    }

    const tunnel = tunnels.get(env.id)
    if (!tunnel || tunnel.ws.readyState !== WebSocket.OPEN) {
      clientWs.close(4002, 'no active tunnel')
      return
    }

    const reqId = id('ws')
    const upstreamPath = normalizeUpstreamPath(m[2] || '')
    let pathWithQuery = upstreamPath ? `/${upstreamPath}` : '/'
    if (url.search) pathWithQuery += url.search

    // Forward headers: strip hop-by-hop and handshake headers, replace with target environment credentials.
    const headers = forwardHeaders(request.headers, [
      'host',
      'authorization',
      'connection',
      'content-length',
      'accept-encoding',
      'sec-websocket-key',
      'sec-websocket-version',
      'sec-websocket-extensions',
      'sec-websocket-protocol',
      'upgrade',
      'origin',
    ])
    headers.authorization = 'Basic ' + Buffer.from(`${env.username}:${env.password}`).toString('base64')

    tunnel.ws.send(JSON.stringify({ type: 'ws-req', id: reqId, path: pathWithQuery, headers }), (err) => {
      if (err) clientWs.close(4002, 'tunnel send failed')
    })

    clientTerminals.set(reqId, { ws: clientWs, envId: env.id })

    clientWs.on('message', (data) => {
      if (tunnel.ws.readyState !== WebSocket.OPEN) return
      tunnel.ws.send(JSON.stringify({ type: 'ws-data', id: reqId, data: Buffer.from(data).toString('base64') }))
    })
    clientWs.on('close', () => {
      clientTerminals.delete(reqId)
      if (tunnel.ws.readyState === WebSocket.OPEN) {
        tunnel.ws.send(JSON.stringify({ type: 'ws-close', id: reqId }))
      }
    })
    clientWs.on('error', () => {
      clientTerminals.delete(reqId)
    })
  })
}

function clientIp(req) {
  if (TRUST_PROXY) {
    const forwarded = req.headers['x-forwarded-for']
    if (forwarded) return String(forwarded).split(',')[0].trim()
  }
  return req.socket.remoteAddress || 'unknown'
}

// ── Session ────────────────────────────────────────────────────────────────
// Session tokens are the Bearer credentials for the relay API. The App's single-environment proxy mode uses
// Basic Auth (username/password) instead, see basicUser().

function createSession(userId, deviceLabel) {
  const token = newToken()
  db.sessions[token] = {
    userId,
    deviceLabel: deviceLabel || 'unknown',
    createdAt: Date.now(),
    lastSeenAt: Date.now(),
    expiresAt: Date.now() + SESSION_TTL_MS,
    ip: '',
  }
  save()
  return token
}

function sessionUser(req) {
  const token = bearer(req)
  if (!token) return null
  const session = db.sessions[token]
  if (!session) return null
  // Expire stale sessions on access (lazy expiry).
  if (Date.now() - session.lastSeenAt > SESSION_TTL_MS) {
    delete db.sessions[token]
    save()
    return null
  }
  const user = db.users[session.userId]
  if (!user) return null
  session.lastSeenAt = Date.now()
  session.expiresAt = Date.now() + SESSION_TTL_MS
  session.ip = clientIp(req)
  return { user, session, token }
}

// ── Environment registry ──────────────────────────────────────────────────
// An Environment = one opencode server on one machine.
// url points to that machine's OpenTunnel entry; password is that opencode's Basic Auth password.

function listEnvironments(userId) {
  return Object.values(db.environments)
    .filter((env) => env.ownerId === userId)
    .sort((a, b) => {
      // Online first, then sorted by name.
      const online = Number(environmentStatus(b) === 'online') - Number(environmentStatus(a) === 'online')
      if (online !== 0) return online
      return a.name.localeCompare(b.name)
    })
    .map(publicEnvironment)
}

// Environment online status: in tunnel mode, depends solely on whether there is an active reverse tunnel connection.
// Does not rely on heartbeat-written status — after the desktop exits, relay won't immediately receive a heartbeat,
// using the stored value would keep offline machines appearing as online.
function environmentStatus(env) {
  const tunnel = tunnels.get(env.id)
  return tunnel && tunnel.ws.readyState === WebSocket.OPEN ? 'online' : 'offline'
}

function publicEnvironment(env) {
  return {
    id: env.id,
    name: env.name,
    description: env.description || '',
    url: env.url,
    username: env.username || 'opencode',
    status: environmentStatus(env),
    hostname: env.hostname || '',
    version: env.version || '',
    platform: env.platform || '',
    tunnelHostname: env.tunnelHostname || '',
    deviceId: env.deviceId || '',
    lastSeenAt: env.lastSeenAt || null,
    createdAt: env.createdAt,
  }
}

// Find environment by id.
//
// In practice, the Android client collapses consecutive underscores in URLs into one:
//   request env__hcqZ9SU3Z7c → actually sends env_hcqZ9SU327c
// Exact matching would 404, and the client would judge 'server unreachable'.
// So matching ignores differences in underscore count.
function findEnvironment(envId) {
  const exact = db.environments[envId]
  if (exact) return exact

  const collapsed = envId.replace(/_+/g, '_')
  const match = Object.values(db.environments).find(
    (env) => env.id.replace(/_+/g, '_') === collapsed
  )
  return match || null
}

// ── Routes ────────────────────────────────────────────────────────────────

const routes = []
function route(method, pattern, handler) {
  // The order of keys must match the order of capture groups in the regex,
  // otherwise params will be misaligned (e.g., if :rest* is replaced first, envId and rest would swap).
  // So keys are collected in order of appearance, then the regex is constructed in one pass.
  const keys = []
  const keyRe = /:([A-Za-z0-9_]+)(\*)?/g
  let m
  while ((m = keyRe.exec(pattern)) !== null) keys.push(m[1])

  const regex = new RegExp(
    '^' +
      pattern
        // :name* captures the rest (including /) — must be handled before :name,
        // otherwise :rest* would be matched by :rest first, leaving a stray *.
        // The leading slash is made optional so the base root (without trailing slash) also matches:
        //   /api/proxy/<id>      → rest is undefined
        //   /api/proxy/<id>/     → rest is empty string
        //   /api/proxy/<id>/api/x → rest = api/x
        .replace(/\/:([A-Za-z0-9_]+)\*/g, '(?:\\/(.*))?')
        // :name captures one segment (excluding /)
        .replace(/:([A-Za-z0-9_]+)/g, '([^/]+)') +
      '$'
  )
  routes.push({ method, regex, keys, handler })
}

function match(method, pathname) {
  for (const r of routes) {
    if (r.method !== method) continue
    const m = r.regex.exec(pathname)
    if (m) {
      const params = {}
      r.keys.forEach((key, i) => {
        // Optional capture groups may not participate in the match, in which case they are undefined
        params[key] = m[i + 1] === undefined ? '' : decodeURIComponent(m[i + 1])
      })
      return { handler: r.handler, params }
    }
  }
  return null
}

// ── Root path transparent proxy ──────────────────────────────────────────────
//
// OpenCode Mobile's WebView loads the opencode web version (SPA).
// SPA static assets use absolute paths (/_assets/xxx.js, /icons/..., /site.webmanifest),
// and its internal API base uses location.origin — neither carries the
// /api/proxy/<envId> prefix, they go directly to the relay root.
//
// So the relay root must itself be a usable opencode entry:
// forward all requests that don't match relay's own routes to the 'default environment'.
//
// Relay's own routes (accounts, environment list, proxy paths) take precedence and are unaffected.

// Default environment: if there's only one, it's that one; if multiple, the one with the most recent heartbeat.
function defaultEnvironment() {
  const envs = Object.values(db.environments)
  if (!envs.length) return null
  return envs.sort((a, b) => (b.lastSeenAt || 0) - (a.lastSeenAt || 0))[0]
}

// These paths are owned by relay and must not be forwarded to opencode.
const RELAY_OWNED = [
  /^\/api\/auth\//,
  /^\/api\/environments(\/|$)/,
  /^\/api\/proxy\//,
]

function isRelayOwned(pathname) {
  return RELAY_OWNED.some((re) => re.test(pathname))
}

// ── Public API ────────────────────────────────────────────────────────────

// Health check: used by App to probe server reachability
route('GET', '/global/health', async (req, res) => json(res, 200, { status: 'ok' }))

// /api/info is not answered by relay itself: relay's fake identity route was removed,
// letting it fall through to the default environment proxy, forwarding to the real opencode.
// This way the SPA (Android WebView loading at root /) gets version "2.2.5"
// instead of "relay-1.0.0", and won't judge the server as incompatible.

// Register
route('POST', '/api/auth/register', async (req, res) => {
  const ip = clientIp(req)
  if (!rateLimitCheck(ip)) {
    return json(res, 429, { error: 'too many requests, try again later' })
  }
  const body = await readBody(req)
  const username = String(body.username || '').trim()
  const password = String(body.password || '')
  if (!/^[A-Za-z0-9_.-]{3,32}$/.test(username)) {
    return json(res, 400, { error: 'username must be 3-32 chars of [A-Za-z0-9_.-]' })
  }
  if (password.length < 12 || password.length > 256) {
    return json(res, 400, { error: 'password must be 12-256 characters' })
  }
  const existing = Object.values(db.users).find((u) => u.username === username)
  if (existing) return json(res, 409, { error: 'username already taken' })

  const userId = id('usr')
  const { salt, hash } = hashPassword(password)
  db.users[userId] = {
    id: userId,
    username,
    salt,
    hash,
    createdAt: Date.now(),
  }
  save()

  const token = createSession(userId, body.deviceLabel)
  json(res, 201, { token, user: { id: userId, username } })
})

// Login
route('POST', '/api/auth/login', async (req, res) => {
  const ip = clientIp(req)
  if (!rateLimitCheck(ip)) {
    return json(res, 429, { error: 'too many requests, try again later' })
  }
  const body = await readBody(req)
  const username = String(body.username || '').trim()
  const password = String(body.password || '')
  const user = Object.values(db.users).find((u) => u.username === username)
  if (!user || !verifyPassword(password, user.salt, user.hash)) {
    return json(res, 401, { error: 'invalid credentials' })
  }
  const token = createSession(user.id, body.deviceLabel)
  json(res, 200, { token, user: { id: user.id, username: user.username } })
})

// Current user
route('GET', '/api/auth/me', async (req, res) => {
  const auth = sessionUser(req)
  if (!auth) return json(res, 401, { error: 'unauthorized' })
  json(res, 200, {
    user: { id: auth.user.id, username: auth.user.username },
    session: { deviceLabel: auth.session.deviceLabel, createdAt: auth.session.createdAt },
  })
})

// Logout (destroy current session)
route('POST', '/api/auth/logout', async (req, res) => {
  const token = bearer(req)
  if (token && db.sessions[token]) {
    delete db.sessions[token]
    save()
  }
  json(res, 200, { ok: true })
})

// Environment list — this is the core API for 'finding environments to use as servers'
route('GET', '/api/environments', async (req, res) => {
  const auth = sessionUser(req)
  if (!auth) return json(res, 401, { error: 'unauthorized' })
  json(res, 200, { environments: listEnvironments(auth.user.id) })
})

// Register environment (called by desktop share module)
//
// Repeated registration from the same machine (restart, crash recovery, reinstall) must reuse the same environment,
// otherwise the account will accumulate multiple records for 'the same machine', and the client discovery list will show duplicates.
//
// Reuse order:
//   1. Exact deviceId match — the persistent instance identifier on the desktop
//   2. hostname match — fallback for older versions without deviceId, also covers reinstall scenarios
route('POST', '/api/environments', async (req, res) => {
  const auth = sessionUser(req)
  if (!auth) return json(res, 401, { error: 'unauthorized' })
  const body = await readBody(req)
  const name = String(body.name || '').trim()
  const url = String(body.url || '').trim()
  if (!name || name.length > 128) return json(res, 400, { error: 'name is required (max 128 chars)' })
  // In tunnel mode, environments don't need a public ingress: relay forwards through the WebSocket reverse tunnel established by the server.
  // url is kept as display info only and can be empty.
  if (url && !/^https?:\/\//.test(url)) return json(res, 400, { error: 'url must be http(s)://' })

  const deviceId = String(body.deviceId || '').trim()
  const hostname = String(body.hostname || '').trim()
  const owned = Object.values(db.environments).filter((env) => env.ownerId === auth.user.id)

  let existing = null
  if (deviceId) existing = owned.find((env) => env.deviceId === deviceId) || null
  if (!existing && hostname) {
    // The same machine may have multiple historical records (older versions created a new one each time),
    // take the most recently created one as the current environment, and clean up the rest below.
    const sameHost = owned.filter(
      (env) => (env.hostname || '').trim().toLowerCase() === hostname.toLowerCase(),
    )
    existing = sameHost.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0] || null
  }

  if (existing) {
    existing.name = name
    existing.description = String(body.description || '')
    existing.url = url
    existing.username = String(body.username || 'opencode')
    existing.password = String(body.password || '')
    existing.hostname = hostname
    existing.version = String(body.version || '')
    existing.platform = String(body.platform || '')
    if (deviceId) existing.deviceId = deviceId
    existing.lastSeenAt = Date.now()

    // Clean up historical duplicates: older versions created a new record each time, leaving several under the account.
    if (hostname) {
      for (const env of owned) {
        if (env.id === existing.id) continue
        if ((env.hostname || '').trim().toLowerCase() !== hostname.toLowerCase()) continue
        delete db.environments[env.id]
      }
    }

    save()
    return json(res, 200, { environment: publicEnvironment(existing) })
  }

  const envId = id('env')
  const env = {
    id: envId,
    ownerId: auth.user.id,
    deviceId,
    name,
    description: String(body.description || ''),
    url,
    username: String(body.username || 'opencode'),
    password: String(body.password || ''),
    hostname,
    version: String(body.version || ''),
    platform: String(body.platform || ''),
    tunnelHostname: String(body.tunnelHostname || ''),
    status: 'online',
    createdAt: Date.now(),
    lastSeenAt: Date.now(),
  }
  db.environments[envId] = env
  save()
  json(res, 201, { environment: publicEnvironment(env) })
})

// Update environment (used by connector heartbeat)
route('PATCH', '/api/environments/:id', async (req, res, params) => {
  const auth = sessionUser(req)
  if (!auth) return json(res, 401, { error: 'unauthorized' })
  const env = db.environments[params.id]
  if (!env || env.ownerId !== auth.user.id) return json(res, 404, { error: 'not found' })

  const body = await readBody(req)
  for (const key of ['name', 'description', 'url', 'username', 'password', 'hostname', 'version', 'platform', 'tunnelHostname', 'deviceId', 'status']) {
    if (body[key] !== undefined) env[key] = String(body[key])
  }
  env.lastSeenAt = Date.now()
  save()
  json(res, 200, { environment: publicEnvironment(env) })
})

// Heartbeat: connector reports periodically, also probes tunnel entry
route('POST', '/api/environments/:id/heartbeat', async (req, res, params) => {
  const auth = sessionUser(req)
  if (!auth) return json(res, 401, { error: 'unauthorized' })
  const env = db.environments[params.id]
  if (!env || env.ownerId !== auth.user.id) return json(res, 404, { error: 'not found' })

  const body = await readBody(req)
  if (body.version) env.version = String(body.version)
  if (body.platform) env.platform = String(body.platform)
  if (body.hostname) env.hostname = String(body.hostname)
  if (body.tunnelHostname) env.tunnelHostname = String(body.tunnelHostname)

  // Probe: in tunnel mode, environment online = has an active WebSocket reverse tunnel.
  const tunnel = tunnels.get(env.id)
  const reachable = Boolean(tunnel && tunnel.ws.readyState === WebSocket.OPEN)
  const status = reachable ? 'online' : 'offline'

  env.status = status
  env.reachable = reachable
  env.lastSeenAt = Date.now()
  save()
  json(res, 200, { environment: publicEnvironment(env) })
})

// Delete environment
route('DELETE', '/api/environments/:id', async (req, res, params) => {
  const auth = sessionUser(req)
  if (!auth) return json(res, 401, { error: 'unauthorized' })
  const env = db.environments[params.id]
  if (!env || env.ownerId !== auth.user.id) return json(res, 404, { error: 'not found' })
  delete db.environments[params.id]
  save()
  json(res, 200, { ok: true })
})

// ── App access layer ──────────────────────────────────────────────────────
//
// OpenCode Mobile uses a 'manual URL entry' form and doesn't know about relay's environment list.
// This layer's purpose: give the App a URL it recognizes, returning connection info it can use.
//
// Two usage modes:
//   A) Enter https://relay:9999  → App gets relay's /api/info (relay itself is a fake opencode)
//   B) Enter https://relay:9999/<envId> → relay acts as a 'single-environment proxy' and passes through opencode's API
//
// B is the actually usable mode: A can only list environments, cannot drive sessions.

// Single-environment proxy: relay acts as a transparent proxy in front of opencode.
// App uses relay account credentials for Basic Auth here; relay validates and replaces with the environment's opencode password for forwarding.
//
// Path forms:
//   /api/proxy/<envId>/api/...   → forwards to opencode's /api/...
//   /api/proxy/<envId>/...       → forwards to opencode's /...
//   /api/proxy/<envId>           → forwards to opencode's /
//
// The client probes the base root with HEAD (in practice, Android does HEAD+GET every 5 seconds),
// so HEAD must also be proxied, not 404 — the client uses it to determine 'server reachable'.
route('GET', '/api/proxy/:envId/:rest*', async (req, res, params) => proxy(req, res, params.envId, params.rest || ''))
route('HEAD', '/api/proxy/:envId/:rest*', async (req, res, params) => proxy(req, res, params.envId, params.rest || ''))
route('POST', '/api/proxy/:envId/:rest*', async (req, res, params) => proxy(req, res, params.envId, params.rest || ''))
route('PUT', '/api/proxy/:envId/:rest*', async (req, res, params) => proxy(req, res, params.envId, params.rest || ''))
route('PATCH', '/api/proxy/:envId/:rest*', async (req, res, params) => proxy(req, res, params.envId, params.rest || ''))
route('DELETE', '/api/proxy/:envId/:rest*', async (req, res, params) => proxy(req, res, params.envId, params.rest || ''))

async function proxy(req, res, envId, rest, opts = {}) {
  const env = findEnvironment(envId)
  if (!env) return json(res, 404, { _tag: 'UnauthorizedError', message: 'unknown environment' })

  // Android WebView loads the user-entered 'server URL' directly as a page.
  // URL is /api/proxy/<envId>/ → SPA router doesn't recognize this pathname → crash.
  // When a browser loads a page, Accept contains text/html; native API calls don't.
  // Redirect 302 to root /, where SPA initializes normally and the router returns {type:'home'}.
  // PC Electron's WebView uses the oc:// protocol, doesn't go through here, unaffected.
  // The root path (default environment proxy) also has empty rest, but pathname is / not /api/proxy/...,
  // distinguished by opts.fromRoot: only proxy routes trigger redirect, root path is unaffected.
  if (rest === '' && req.method === 'GET' && !opts.fromRoot) {
    const accept = req.headers.accept || ''
    if (accept.includes('text/html')) {
      res.writeHead(302, { location: '/' })
      return res.end()
    }
  }

  const upstreamPath = normalizeUpstreamPath(rest)

  // Client request path construction rules (observed from OpenCode client):
  //   base ending with /api → requests /api/api/info
  //   base without /api → requests /api/info
  // Both must forward to opencode's /api/info, so the extra /api prefix is stripped uniformly here.

  // SPA static assets are public like opencode (upstream doesn't require credentials).
  // Browsers loading the SPA won't send Authorization headers; if relay blocks them,
  // the page goes blank. So static assets skip auth, consistent with upstream.
  const isPublic = opts.publicAsset === true

  if (!isPublic) {
    // Relay account auth: App uses relay account credentials for Basic Auth
    const user = sessionUser(req)?.user || basicUser(req, env.ownerId)
    if (!user) {
      res.writeHead(401, { 'www-authenticate': 'Basic realm="Secure Area"' })
      return res.end(JSON.stringify({ _tag: 'UnauthorizedError', message: 'Authentication required' }))
    }
    if (user.id !== env.ownerId) {
      return json(res, 403, { error: 'environment belongs to another account' })
    }
  }

  // App connection probe: it requests <base>/global/health.
  // opencode v2's API doesn't have this endpoint (only /api/info); forwarding would 404,
  // and App would report 'server unreachable'. So relay answers directly and probes upstream,
  // making the probe result reflect 'link connectivity'.
  if (isHealthPath(upstreamPath)) {
    const reachable = await probeEnvironment(env)
    return json(res, reachable ? 200 : 502, {
      status: reachable ? 'ok' : 'unreachable',
      environment: env.name,
      version: env.version || '',
    })
  }

  // Tunnel mode: relay no longer connects directly to environment URLs, but forwards through the WebSocket reverse tunnel.
  // pathWithQuery is the full path (including query) forwarded to the server.
  let pathWithQuery = upstreamPath ? `/${upstreamPath}` : '/'
  if (req.url.includes('?')) pathWithQuery += req.url.slice(req.url.indexOf('?'))

  // Replace with the environment's opencode credentials
  const headers = forwardHeaders(req.headers, ['host', 'authorization', 'connection', 'content-length', 'accept-encoding'])
  headers.authorization = 'Basic ' + Buffer.from(`${env.username}:${env.password}`).toString('base64')
  headers['accept-encoding'] = 'identity'

  // Regular HTTP requests forwarded through tunnel (including SSE streaming responses).
  // WebSocket upgrade requests do not enter the `request` event here; handled by attachTunnelServer's upgrade handler.
  return tunnelProxy(env.id, req, res, pathWithQuery, headers)
}

// Normalize the client request path into one that opencode actually recognizes.
//
// The client treats base as a pure prefix, then appends '/api/...' itself. So:
//   base = .../env/api   → client requests .../env/api/api/info
//   base = .../env       → client requests .../env/api/info
//
// opencode's API is all under /api, so the rule is: strip all leading /api segments,
// keep only one, then re-add /api.
//   'api/api/info'    → 'api/info'
//   'api/info'        → 'api/info'
//   'api/global/health' → 'api/global/health'
//   'global/health'   → 'api/global/health'
//   'info'            → 'api/info'
//
// But SPA static assets are different, they're at root, not under /api:
//   '_assets/index.js' → '_assets/index.js' (must not become 'api/_assets/index.js')
//   'icons/x.ico'     → 'icons/x.ico'
//
// Empty path is a special case: the client uses it when probing the base root (observed Android doing
// HEAD+GET every 5 seconds on base root). opencode's root returns SPA HTML 200,
// while /api returns 404 — if normalized to 'api', the client would judge
// 'server unreachable' due to 404. So empty path is passed through to upstream root as-is.
function normalizeUpstreamPath(rest) {
  const segments = rest.split('/').filter((s) => s.length > 0)

  // Empty path (client probing base root) passed through as-is, see explanation above
  if (segments.length === 0) return ''

  // SPA static assets are at root (/_assets/*, /icons/*, /site.webmanifest, etc.),
  // don't add /api prefix — otherwise opencode won't find them (observed 404).
  if (isStaticAsset(segments[0])) return segments.join('/')

  // Strip leading consecutive 'api' segments
  const stripped = [...segments]
  while (stripped.length > 0 && stripped[0] === 'api') stripped.shift()

  // opencode's API is all mounted under /api
  if (stripped.length === 0 || stripped[0] !== 'api') stripped.unshift('api')

  return stripped.join('/')
}

// SPA static asset root directories (opencode's frontend build artifacts).
// These paths are under opencode root, not under /api.
const STATIC_ROOTS = new Set([
  '_assets',
  'assets',
  'icons',
  'social-share.png',
  'site.webmanifest',
  'sw.js',
  'web-app-manifest-192x192.png',
  'web-app-manifest-512x512.png',
])

function isStaticAsset(first) {
  return STATIC_ROOTS.has(first)
}

// App health check path. The client constructs <base>/global/health,
// which normalizes to 'api/global/health'.
function isHealthPath(upstreamPath) {
  return upstreamPath === 'api/global/health'
}

async function probeEnvironment(env) {
  // In tunnel mode, environment online status depends on whether there is an active WebSocket reverse tunnel.
  const tunnel = tunnels.get(env.id)
  return Boolean(tunnel && tunnel.ws.readyState === WebSocket.OPEN)
}

// WebSocket proxy: for terminal sessions.
// Use a raw TLS socket to connect directly to the target, send the client's upgrade request as-is,
// then splice the two sockets together for bidirectional forwarding.
// Basic Auth → relay user (for App's single-environment proxy mode)
//
// Only validates credentials, does not create sessions: every App request (including every SSE poll, every WS upgrade)
// carries Basic Auth; if a session were created and persisted each time, sessions would grow unboundedly.
// The username/password itself is the credential, no need to derive a token.
//
// Different clients have different username behaviors:
//   - Desktop (Electron) form has no username field, always sends `opencode:<password>`
//   - Mobile has a username field, sends whatever the user enters (may have case errors)
//
// So username matching is lenient here, the real credential is the password:
// First look up by username (case-insensitive); if not found, fall back to 'identifying by password across all accounts'.
//
// Security boundary unchanged: password must be correct, cross-account access is still blocked by env.ownerId.
function basicUser(req, ownerId) {
  const header = req.headers.authorization || ''
  if (!header.toLowerCase().startsWith('basic ')) return null
  let decoded
  try {
    decoded = Buffer.from(header.slice(6).trim(), 'base64').toString('utf8')
  } catch {
    return null
  }
  const idx = decoded.indexOf(':')
  if (idx < 0) return null
  const username = decoded.slice(0, idx).trim()
  const password = decoded.slice(idx + 1)

  const users = Object.values(db.users)

  // 1. Exact username match
  const exact = users.find((u) => u.username === username)
  if (exact) {
    return verifyPassword(password, exact.salt, exact.hash) ? exact : null
  }

  // 2. Case-insensitive match (mobile users may mistype case)
  const ci = users.find((u) => u.username.toLowerCase() === username.toLowerCase())
  if (ci) {
    return verifyPassword(password, ci.salt, ci.hash) ? ci : null
  }

  // 3. Username doesn't match — if the password is correct and belongs to this environment's owner, allow.
  //    Look up the owner specifically, don't iterate all accounts, to avoid unpredictable behavior from password collisions across accounts.
  if (ownerId) {
    const owner = db.users[ownerId]
    if (owner && verifyPassword(password, owner.salt, owner.hash)) return owner
  }

  // 4. Fallback: when owner is unknown (e.g., non-proxy path), identify by password across all accounts
  for (const user of users) {
    if (verifyPassword(password, user.salt, user.hash)) return user
  }
  return null
}

// ── In single-environment mode, App expects /api/info to return a structure it can parse ────────────────
//
// No separate route needed: the wildcard route /api/proxy/:envId/:rest* will forward /api/info
// directly to the real opencode, returning its own ServerInfo (more accurate than a fake one here).
// The wildcard route is registered first and matched first.

// ── CORS ────────────────────────────────────────────────────────────────
//
// OpenCode's Electron desktop initiates cross-origin fetch from `oc://renderer`,
// and the browser network stack performs full CORS validation.
//
// The request Origin must be echoed (not `*`) for two reasons:
//   1. opencode upstream itself echoes Origin (vary: Origin).
//      If preflight returns `*` but the actual response returns a specific origin, the browser sees inconsistency
//      and blocks the actual request — the client only sees `TypeError: Failed to fetch`,
//      while the server log shows 200, making it very hard to debug.
//   2. When the client sends credentials, the spec requires allow-origin to not be `*`.
//
// Preflight and actual responses must use the same policy, otherwise the browser still blocks.

function applyCors(req, res) {
  const origin = req.headers.origin
  // Requests without Origin (native clients, curl) use wildcard.
  res.setHeader('access-control-allow-origin', origin || '*')
  res.setHeader('vary', 'Origin')
  res.setHeader('access-control-allow-headers', 'authorization, content-type, x-opencode-ticket, x-opencode-capabilities')
  res.setHeader('access-control-allow-methods', 'GET, HEAD, PUT, PATCH, POST, DELETE, OPTIONS')
  res.setHeader('access-control-max-age', '86400')
  if (origin) {
    res.setHeader('access-control-allow-credentials', 'true')
  }
}

// ── Server ──────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const started = Date.now()
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
  const pathname = url.pathname

  applyCors(req, res)

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    return res.end()
  }

  const found = match(req.method, pathname)
  if (!found) {
    // No relay own route matched → delegate to default environment proxy.
    // This is required for the App's embedded WebView to load the opencode web version:
    // SPA static assets use absolute paths, internal API base uses location.origin,
    // both go to the relay root.
    if (!isRelayOwned(pathname)) {
      const env = defaultEnvironment()
      if (env) {
        const rest = pathname.replace(/^\//, '')
        try {
          return await proxy(req, res, env.id, rest, {
            // SPA static assets and index are public upstream, relay stays consistent.
            // Browsers loading SPA won't send Authorization headers; blocking them causes blank page.
            publicAsset: rest === '' || isStaticAsset(rest.split('/')[0]),
            // Root path default environment proxy: does not trigger 302 redirect (that's for /api/proxy/<envId>/)
            fromRoot: true,
          })
        } catch (error) {
          if (!res.headersSent) json(res, 502, { error: 'upstream unreachable', detail: String(error.message || error) })
          else res.end()
          return
        }
      }
    }
    res.writeHead(404, { 'content-type': 'application/json' })
    return res.end(JSON.stringify({ error: 'not found', path: pathname }))
  }

  try {
    await found.handler(req, res, found.params)
  } catch (error) {
    if (!res.headersSent) json(res, 400, { error: String(error.message || error) })
    else res.end()
  } finally {
    const ms = Date.now() - started
    if (pathname !== '/global/health') {
      console.log(`${req.method} ${pathname} ${res.statusCode} ${ms}ms`)
    }
  }
})

// Attach WebSocket reverse tunnel: the server (desktop share module) establishes a persistent connection via /api/tunnel/:envId.
attachTunnelServer(server)

// Periodic cleanup of expired sessions to prevent unbounded growth.
setInterval(() => {
  const now = Date.now()
  let changed = false
  for (const [token, session] of Object.entries(db.sessions)) {
    if (now - session.lastSeenAt > SESSION_TTL_MS) {
      delete db.sessions[token]
      changed = true
    }
  }
  if (changed) save()
}, SESSION_CLEANUP_INTERVAL_MS)

server.listen(PORT, HOST, () => {
  const addr = server.address()
  const actualPort = typeof addr === 'object' && addr ? addr.port : PORT
  console.log(`relay listening on http://${HOST}:${actualPort}`)
  console.log(`data: ${DB_FILE}`)
  console.log(`public base: ${PUBLIC_BASE || '(none)'}`)
})
