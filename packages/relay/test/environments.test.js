import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// ── Test harness ──────────────────────────────────────────────────────────

let serverProcess
let baseUrl
let dataDir

function startServer(env = {}) {
  return new Promise((resolve, reject) => {
    serverProcess = spawn('node', ['server.js'], {
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

    serverProcess.stderr.on('data', () => {})

    serverProcess.stdout.on('data', (chunk) => {
      const match = chunk.toString().match(/listening on http:\/\/127\.0\.0\.1:(\d+)/)
      if (match) {
        baseUrl = `http://127.0.0.1:${match[1]}`
        resolve()
      }
    })

    serverProcess.on('error', reject)
    setTimeout(() => reject(new Error('server failed to start')), 5000)
  })
}

function stopServer() {
  if (serverProcess) {
    serverProcess.kill('SIGTERM')
    serverProcess = null
  }
}

async function api(pathname, opts = {}) {
  const url = new URL(pathname, baseUrl)
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

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Environments', () => {
  let token
  let envId

  before(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'oc-relay-env-'))
    await startServer()
    token = await registerAndLogin('envuser', 'env-password-123')
  })

  after(() => {
    stopServer()
    if (dataDir) rmSync(dataDir, { recursive: true, force: true })
  })

  it('POST /api/environments registers a new environment', async () => {
    const { status, body } = await api('/api/environments', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: {
        name: 'my-mac',
        hostname: 'macbook.local',
        deviceId: 'dev-001',
        version: '2.6.5',
        platform: 'darwin-arm64',
        username: 'opencode',
        password: 'oc-secret',
      },
    })
    assert.equal(status, 201)
    assert.ok(body.environment.id)
    assert.equal(body.environment.name, 'my-mac')
    assert.equal(body.environment.hostname, 'macbook.local')
    assert.equal(body.environment.version, '2.6.5')
    envId = body.environment.id
  })

  it('GET /api/environments lists registered environments', async () => {
    const { status, body } = await api('/api/environments', {
      headers: { authorization: `Bearer ${token}` },
    })
    assert.equal(status, 200)
    assert.ok(body.environments.length >= 1)
    assert.ok(body.environments.some(e => e.name === 'my-mac'))
  })

  it('POST /api/environments with same deviceId reuses existing environment', async () => {
    const { status, body } = await api('/api/environments', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: {
        name: 'my-mac-renamed',
        hostname: 'macbook.local',
        deviceId: 'dev-001',
        version: '2.6.6',
        platform: 'darwin-arm64',
      },
    })
    assert.equal(status, 200) // 200 = updated, not 201 = created
    assert.equal(body.environment.id, envId)
    assert.equal(body.environment.name, 'my-mac-renamed')
    assert.equal(body.environment.version, '2.6.6')
  })

  it('rejects environment without name', async () => {
    const { status } = await api('/api/environments', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: { hostname: 'no-name' },
    })
    assert.equal(status, 400)
  })

  it('rejects environment with invalid url', async () => {
    const { status } = await api('/api/environments', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: { name: 'bad-url', url: 'not-a-url' },
    })
    assert.equal(status, 400)
  })

  it('requires authentication', async () => {
    const { status } = await api('/api/environments')
    assert.equal(status, 401)
  })

  it('PATCH /api/environments/:id updates environment', async () => {
    const { status, body } = await api(`/api/environments/${envId}`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${token}` },
      body: { name: 'patched-name', version: '3.0.0' },
    })
    assert.equal(status, 200)
    assert.equal(body.environment.name, 'patched-name')
    assert.equal(body.environment.version, '3.0.0')
  })

  it('POST /api/environments/:id/heartbeat probes tunnel status', async () => {
    const { status, body } = await api(`/api/environments/${envId}/heartbeat`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: { hostname: 'macbook.local', version: '3.0.0' },
    })
    assert.equal(status, 200)
    assert.equal(body.environment.status, 'offline') // no active tunnel
  })

  it('DELETE /api/environments/:id removes environment', async () => {
    const { status } = await api(`/api/environments/${envId}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` },
    })
    assert.equal(status, 200)

    // Verify it's gone
    const list = await api('/api/environments', {
      headers: { authorization: `Bearer ${token}` },
    })
    assert.ok(!list.body.environments.some(e => e.id === envId))
  })

  it('returns 404 for unknown environment', async () => {
    const { status } = await api('/api/environments/nonexistent', {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` },
    })
    assert.equal(status, 404)
  })
})
