import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
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
        RELAY_SESSION_TTL_MS: '1000',
        RELAY_SESSION_CLEANUP_MS: '500',
        RELAY_RATE_LIMIT_WINDOW_MS: '2000',
        RELAY_RATE_LIMIT_MAX: '5',
        ...env,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let stderr = ''
    serverProcess.stderr.on('data', (chunk) => { stderr += chunk.toString() })

    serverProcess.stdout.on('data', (chunk) => {
      const line = chunk.toString()
      const match = line.match(/listening on http:\/\/127\.0\.0\.1:(\d+)/)
      if (match) {
        baseUrl = `http://127.0.0.1:${match[1]}`
        resolve()
      }
    })

    serverProcess.on('error', reject)
    setTimeout(() => reject(new Error('server failed to start: ' + stderr)), 5000)
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

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Relay server', () => {
  before(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'oc-relay-test-'))
    await startServer({
      RELAY_RATE_LIMIT_WINDOW_MS: '60000',
      RELAY_RATE_LIMIT_MAX: '100',
      RELAY_SESSION_TTL_MS: '1000',
      RELAY_SESSION_CLEANUP_MS: '500',
    })
  })

  after(() => {
    stopServer()
    if (dataDir) rmSync(dataDir, { recursive: true, force: true })
  })

  describe('Health check', () => {
    it('GET /global/health returns 200 ok', async () => {
      const { status, body } = await api('/global/health')
      assert.equal(status, 200)
      assert.equal(body.status, 'ok')
    })
  })

  describe('Auth: register', () => {
    it('registers a new account and returns a token', async () => {
      const { status, body } = await api('/api/auth/register', {
        method: 'POST',
        body: { username: 'testuser1', password: 'test-password-123', deviceLabel: 'test' },
      })
      assert.equal(status, 201)
      assert.ok(body.token)
      assert.equal(body.user.username, 'testuser1')
      assert.ok(body.user.id)
    })

    it('rejects duplicate username', async () => {
      const { status, body } = await api('/api/auth/register', {
        method: 'POST',
        body: { username: 'testuser1', password: 'test-password-123' },
      })
      assert.equal(status, 409)
      assert.match(body.error, /already taken/i)
    })

    it('rejects short username', async () => {
      const { status } = await api('/api/auth/register', {
        method: 'POST',
        body: { username: 'ab', password: 'test-password-123' },
      })
      assert.equal(status, 400)
    })

    it('rejects short password', async () => {
      const { status } = await api('/api/auth/register', {
        method: 'POST',
        body: { username: 'validuser', password: 'short' },
      })
      assert.equal(status, 400)
    })

    it('rejects overly long password', async () => {
      const { status } = await api('/api/auth/register', {
        method: 'POST',
        body: { username: 'validuser2', password: 'a'.repeat(257) },
      })
      assert.equal(status, 400)
    })
  })

  describe('Auth: login', () => {
    it('logs in with correct credentials', async () => {
      const { status, body } = await api('/api/auth/login', {
        method: 'POST',
        body: { username: 'testuser1', password: 'test-password-123' },
      })
      assert.equal(status, 200)
      assert.ok(body.token)
      assert.equal(body.user.username, 'testuser1')
    })

    it('rejects wrong password', async () => {
      const { status } = await api('/api/auth/login', {
        method: 'POST',
        body: { username: 'testuser1', password: 'wrong-password-!!!' },
      })
      assert.equal(status, 401)
    })

    it('rejects nonexistent user', async () => {
      const { status } = await api('/api/auth/login', {
        method: 'POST',
        body: { username: 'ghost', password: 'no-such-user-12' },
      })
      assert.equal(status, 401)
    })
  })

  describe('Auth: me', () => {
    it('returns current user with valid token', async () => {
      const login = await api('/api/auth/login', {
        method: 'POST',
        body: { username: 'testuser1', password: 'test-password-123' },
      })
      const { status, body } = await api('/api/auth/me', {
        headers: { authorization: `Bearer ${login.body.token}` },
      })
      assert.equal(status, 200)
      assert.equal(body.user.username, 'testuser1')
    })

    it('rejects without token', async () => {
      const { status } = await api('/api/auth/me')
      assert.equal(status, 401)
    })

    it('rejects invalid token', async () => {
      const { status } = await api('/api/auth/me', {
        headers: { authorization: 'Bearer invalid-token' },
      })
      assert.equal(status, 401)
    })
  })

  describe('Auth: logout', () => {
    it('destroys the current session', async () => {
      const login = await api('/api/auth/login', {
        method: 'POST',
        body: { username: 'testuser1', password: 'test-password-123' },
      })
      const { status } = await api('/api/auth/logout', {
        method: 'POST',
        headers: { authorization: `Bearer ${login.body.token}` },
      })
      assert.equal(status, 200)

      // Token should no longer work
      const me = await api('/api/auth/me', {
        headers: { authorization: `Bearer ${login.body.token}` },
      })
      assert.equal(me.status, 401)
    })
  })

  describe('Rate limiting', () => {
    it('returns 429 after exceeding the limit', async () => {
      // Stop the main server and start one with a low rate limit.
      stopServer()
      await startServer({
        RELAY_RATE_LIMIT_WINDOW_MS: '2000',
        RELAY_RATE_LIMIT_MAX: '3',
        RELAY_SESSION_TTL_MS: '60000',
        RELAY_SESSION_CLEANUP_MS: '30000',
      })

      // Fire 4 login attempts with a fresh username (limit is 3 per 2s).
      const results = []
      for (let i = 0; i < 4; i++) {
        results.push(await api('/api/auth/login', {
          method: 'POST',
          body: { username: 'ratelimit', password: 'wrong-password-12' },
        }))
      }

      // At least one should be 429
      assert.ok(results.some(r => r.status === 429), 'expected at least one 429 response')
    })
  })

  describe('Session expiry', () => {
    it('expires sessions after TTL', async () => {
      // Restart server with a short session TTL and high rate limit.
      stopServer()
      await startServer({
        RELAY_RATE_LIMIT_WINDOW_MS: '60000',
        RELAY_RATE_LIMIT_MAX: '100',
        RELAY_SESSION_TTL_MS: '1000',
        RELAY_SESSION_CLEANUP_MS: '500',
      })

      const login = await api('/api/auth/register', {
        method: 'POST',
        body: { username: 'expiryuser', password: 'test-password-123' },
      })
      assert.equal(login.status, 201)

      // Wait for TTL (1s) + cleanup (500ms)
      await new Promise(r => setTimeout(r, 2000))

      const me = await api('/api/auth/me', {
        headers: { authorization: `Bearer ${login.body.token}` },
      })
      assert.equal(me.status, 401)
    })
  })
})
