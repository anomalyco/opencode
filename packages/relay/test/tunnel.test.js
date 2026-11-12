import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { WebSocket } from 'ws'

// ── Test harness ──────────────────────────────────────────────────────────

let relayProcess
let relayUrl
let dataDir

function startRelay(env = {}) {
  return new Promise((resolve, reject) => {
    relayProcess = spawn('node', ['server.js'], {
      cwd: join(import.meta.dirname, '..'),
      env: {
        ...process.env,
        RELAY_PORT: '0',
        RELAY_HOST: '127.0.0.1',
        RELAY_DATA_DIR: dataDir,
        RELAY_TRUST_PROXY: '1',
        RELAY_RATE_LIMIT_WINDOW_MS: '60000',
        RELAY_RATE_LIMIT_MAX: '100',
        ...env,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    relayProcess.stderr.on('data', () => {})

    relayProcess.stdout.on('data', (chunk) => {
      const match = chunk.toString().match(/listening on http:\/\/127\.0\.0\.1:(\d+)/)
      if (match) {
        relayUrl = `http://127.0.0.1:${match[1]}`
        resolve()
      }
    })

    relayProcess.on('error', reject)
    setTimeout(() => reject(new Error('relay failed to start')), 5000)
  })
}

function stopRelay() {
  if (relayProcess) {
    relayProcess.kill('SIGTERM')
    relayProcess = null
  }
}

async function api(pathname, opts = {}) {
  const url = new URL(pathname, relayUrl)
  const headers = { 'content-type': 'application/json', ...opts.headers }
  const res = await fetch(url, {
    method: opts.method || 'GET',
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  })
  const text = await res.text()
  let body
  try { body = text ? JSON.parse(text) : null } catch { body = text }
  return { status: res.status, headers: res.headers, body }
}

async function registerAndLogin(username, password) {
  await api('/api/auth/register', {
    method: 'POST',
    body: { username, password, deviceLabel: 'test' },
  })
  const login = await api('/api/auth/login', {
    method: 'POST',
    body: { username, password },
  })
  return login.body.token
}

// Pack a V2 binary frame: [idLen:2B BE][id][data]
function packBinaryFrame(id, data) {
  const idBuf = Buffer.from(id, 'utf8')
  const header = Buffer.alloc(2)
  header.writeUInt16BE(idBuf.length, 0)
  return Buffer.concat([header, idBuf, data])
}

function unpackBinaryFrame(raw) {
  const idLen = raw.readUInt16BE(0)
  const id = raw.subarray(2, 2 + idLen).toString('utf8')
  const data = raw.subarray(2 + idLen)
  return { id, data }
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Tunnel proxy + V2 binary frames', () => {
  let token
  let envId

  before(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'oc-relay-tunnel-'))
    await startRelay()
    token = await registerAndLogin('tunneluser', 'tunnel-password-123')
  })

  after(() => {
    stopRelay()
    if (dataDir) rmSync(dataDir, { recursive: true, force: true })
  })

  it('registers an environment', async () => {
    const { status, body } = await api('/api/environments', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: {
        name: 'tunnel-test-env',
        hostname: 'test-host',
        deviceId: 'tunnel-dev-001',
        version: '2.6.5',
        platform: 'darwin-arm64',
        username: 'opencode',
        password: 'oc-secret',
      },
    })
    assert.equal(status, 201)
    envId = body.environment.id
  })

  it('establishes a V2 WebSocket reverse tunnel', async () => {
    const wsUrl = relayUrl.replace('http', 'ws') + `/api/tunnel/${envId}`
    const ws = new WebSocket(wsUrl, 'oc-tunnel-v2', {
      headers: { authorization: `Bearer ${token}` },
    })

    await new Promise((resolve, reject) => {
      ws.on('open', resolve)
      ws.on('error', reject)
      setTimeout(() => reject(new Error('tunnel connect timeout')), 5000)
    })

    assert.equal(ws.protocol, 'oc-tunnel-v2')
    ws.close()
  })

  it('forwards an HTTP request through V2 tunnel and returns response', async () => {
    const wsUrl = relayUrl.replace('http', 'ws') + `/api/tunnel/${envId}`
    const ws = new WebSocket(wsUrl, 'oc-tunnel-v2', {
      headers: { authorization: `Bearer ${token}` },
    })

    await new Promise((resolve, reject) => {
      ws.on('open', resolve)
      ws.on('error', reject)
      setTimeout(() => reject(new Error('tunnel connect timeout')), 5000)
    })

    // Simulate a desktop that responds to relay-forwarded requests.
    // The desktop side receives a t:1 (request start) + binary body chunks + t:2 (body end),
    // then responds with t:3 (response headers) + binary body chunks + t:4 (response end).

    const messages = []
    ws.on('message', (raw, isBinary) => {
      if (isBinary) {
        const { id, data } = unpackBinaryFrame(raw)
        messages.push({ type: 'binary', id, data })
      } else {
        const msg = JSON.parse(raw.toString())
        messages.push({ type: 'text', ...msg })
      }
    })

    // Wait for the t:1 request start message after a client makes a proxy request.
    // Trigger the proxy request in parallel.
    const proxyPromise = api(`/api/proxy/${envId}/api/test`, {
      headers: { authorization: 'Basic ' + Buffer.from('tunneluser:tunnel-password-123').toString('base64') },
      method: 'POST',
      body: { hello: 'world' },
    })

    // Wait for t:1 (request start) + binary frame (body) + t:2 (body end)
    await new Promise(r => setTimeout(r, 200))

    const t1 = messages.find(m => m.t === 1)
    assert.ok(t1, 'expected t:1 request start message')
    assert.ok(t1.id, 't:1 should have an id')
    assert.equal(t1.method, 'POST')
    assert.ok(t1.path.includes('api/test'))

    const binaryChunk = messages.find(m => m.type === 'binary' && m.id === t1.id)
    assert.ok(binaryChunk, 'expected a binary body chunk')
    assert.deepEqual(JSON.parse(binaryChunk.data.toString()), { hello: 'world' })

    const t2 = messages.find(m => m.t === 2)
    assert.ok(t2, 'expected t:2 request body end')

    // Respond: t:3 (response headers) + binary body + t:4 (response end)
    ws.send(JSON.stringify({ t: 3, id: t1.id, status: 200, headers: { 'content-type': 'application/json' } }))
    ws.send(packBinaryFrame(t1.id, Buffer.from(JSON.stringify({ ok: true }))), { binary: true })
    ws.send(JSON.stringify({ t: 4, id: t1.id }))

    // Check the proxy response
    const proxy = await proxyPromise
    assert.equal(proxy.status, 200)
    assert.deepEqual(proxy.body, { ok: true })

    ws.close()
  })

  it('rejects tunnel connection with wrong token', async () => {
    const wsUrl = relayUrl.replace('http', 'ws') + `/api/tunnel/${envId}`
    const ws = new WebSocket(wsUrl, 'oc-tunnel-v2', {
      headers: { authorization: 'Bearer wrong-token' },
    })

    const code = await new Promise((resolve) => {
      ws.on('close', (code) => resolve(code))
      ws.on('error', () => resolve(null))
      setTimeout(() => resolve(null), 3000)
    })

    assert.equal(code, 4001) // unauthorized
  })

  it('rejects tunnel connection for unknown environment', async () => {
    const wsUrl = relayUrl.replace('http', 'ws') + `/api/tunnel/nonexistent`
    const ws = new WebSocket(wsUrl, 'oc-tunnel-v2', {
      headers: { authorization: `Bearer ${token}` },
    })

    const code = await new Promise((resolve) => {
      ws.on('close', (code) => resolve(code))
      ws.on('error', () => resolve(null))
      setTimeout(() => resolve(null), 3000)
    })

    assert.equal(code, 4004) // unknown environment
  })

  it('returns 502 when no active tunnel exists', async () => {
    const { status } = await api(`/api/proxy/${envId}/api/info`, {
      headers: { authorization: 'Basic ' + Buffer.from('tunneluser:tunnel-password-123').toString('base64') },
    })
    assert.equal(status, 502)
  })
})
