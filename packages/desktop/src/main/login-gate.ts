// Desktop login gate: forces Microsoft Entra ID auth or admin bypass before
// the main window is shown. Mirrors the CLI login gate logic for the desktop.
import { app, BrowserWindow, ipcMain } from "electron"
import { createServer } from "node:http"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { writeFileSync, unlinkSync } from "node:fs"
import { getLogger } from "./logging"

// Root path for resolving preload scripts at runtime.
// Defined at module level (same pattern as windows.ts) so it resolves to the
// bundle location regardless of where it's called from.
const PRELOAD_ROOT = dirname(fileURLToPath(import.meta.url))

// --- Constants ---

const ADMIN_DEFAULT_USERNAME = "admin"
const ADMIN_DEFAULT_PASSWORD = "opencode-admin"

const DEFAULT_TENANT = "oneinfoconsulting.com"
const DEFAULT_CLIENT_ID = "cb06d541-ed31-4195-b7ff-d2b50084da6f"
const DEFAULT_SCOPES = "openid email profile offline_access"
const OAUTH_HOST = "127.0.0.1"
const OAUTH_PORT = 53800
const OAUTH_REDIRECT_PATH = "/callback"
const REDIRECT_URI = `http://${OAUTH_HOST}:${OAUTH_PORT}${OAUTH_REDIRECT_PATH}`

const WINDOW_WIDTH = 440
const WINDOW_HEIGHT = 540

// --- Helpers ---

function resolveMicrosoftConfig() {
  return {
    tenant: process.env["MICROSOFT_TENANT"] ?? DEFAULT_TENANT,
    clientId: process.env["MICROSOFT_CLIENT_ID"] ?? DEFAULT_CLIENT_ID,
    scopes: process.env["MICROSOFT_SCOPES"] ?? DEFAULT_SCOPES,
    redirectUri: REDIRECT_URI,
  }
}

function isBypassEnabled(): boolean {
  return process.env["MICROSOFT_LOGIN_BYPASS"] === "1"
}

function validateAdmin(username: string, password: string): boolean {
  const expectedUser = process.env["OPENCODE_ADMIN_USERNAME"] ?? ADMIN_DEFAULT_USERNAME
  const expectedPass = process.env["OPENCODE_ADMIN_PASSWORD"] ?? ADMIN_DEFAULT_PASSWORD
  return username === expectedUser && password === expectedPass
}

// --- PKCE Helpers ---

interface PkceCodes {
  verifier: string
  challenge: string
}

function generateRandomString(length: number): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"
  return Array.from(crypto.getRandomValues(new Uint8Array(length)))
    .map((b) => chars[b % chars.length])
    .join("")
}

function base64UrlEncode(buffer: ArrayBuffer): string {
  const binary = String.fromCharCode(...new Uint8Array(buffer))
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

async function generatePKCE(): Promise<PkceCodes> {
  const verifier = generateRandomString(64)
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
  return { verifier, challenge: base64UrlEncode(hash) }
}

function generateState(): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)).buffer)
}

function buildAuthorizeUrl(tenant: string, pkce: PkceCodes, state: string, clientId: string, scopes: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    scope: scopes,
    code_challenge: pkce.challenge,
    code_challenge_method: "S256",
    state,
    prompt: "select_account",
  })
  return `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize?${params.toString()}`
}

// --- OAuth Callback Server ---

interface TokenResponse {
  access_token: string
  refresh_token: string
  id_token?: string
  token_type?: string
  expires_in?: number
  scope?: string
}

let oauthServer: ReturnType<typeof createServer> | undefined
let pendingOAuth:
  | { pkce: PkceCodes; state: string; resolve: (tokens: TokenResponse) => void; reject: (error: Error) => void }
  | undefined

async function exchangeCodeForTokens(code: string, pkce: PkceCodes, config: ReturnType<typeof resolveMicrosoftConfig>) {
  const response = await fetch(`https://login.microsoftonline.com/${config.tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: config.redirectUri,
      client_id: config.clientId,
      code_verifier: pkce.verifier,
    }).toString(),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => "")
    throw new Error(`Microsoft token exchange failed (${response.status})${detail ? `: ${detail}` : ""}`)
  }
  return response.json() as Promise<TokenResponse>
}

function startOAuthServer(): Promise<void> {
  if (oauthServer) return Promise.resolve()

  const logger = getLogger()
  const server = createServer((req, res) => {
    const reqUrl = req.url || "/"
    const url = new URL(reqUrl, `http://${OAUTH_HOST}:${OAUTH_PORT}`)

    if (url.pathname === OAUTH_REDIRECT_PATH) {
      const code = url.searchParams.get("code")
      const state = url.searchParams.get("state")
      const error = url.searchParams.get("error")
      const errorDescription = url.searchParams.get("error_description")

      if (error) {
        const errorMsg = errorDescription || error
        pendingOAuth?.reject(new Error(errorMsg))
        pendingOAuth = undefined
        res.writeHead(200, { "Content-Type": "text/html" })
        res.end(`<html><body><h1>Error</h1><p>${escapeHtml(errorMsg)}</p></body></html>`)
        return
      }

      if (!code) {
        pendingOAuth?.reject(new Error("Missing authorization code"))
        pendingOAuth = undefined
        res.writeHead(400, { "Content-Type": "text/html" })
        res.end("<html><body><h1>Error</h1><p>Missing authorization code</p></body></html>")
        return
      }

      if (!pendingOAuth || state !== pendingOAuth.state) {
        pendingOAuth?.reject(new Error("Invalid state - potential CSRF attack"))
        pendingOAuth = undefined
        res.writeHead(400, { "Content-Type": "text/html" })
        res.end("<html><body><h1>Error</h1><p>Invalid state</p></body></html>")
        return
      }

      const current = pendingOAuth
      pendingOAuth = undefined

      exchangeCodeForTokens(code, current.pkce, resolveMicrosoftConfig())
        .then((tokens) => current.resolve(tokens))
        .catch((err) => current.reject(err))

      res.writeHead(200, { "Content-Type": "text/html" })
      res.end(HTML_SUCCESS)
      return
    }

    if (url.pathname === "/cancel") {
      pendingOAuth?.reject(new Error("Login cancelled"))
      pendingOAuth = undefined
      res.writeHead(200)
      res.end("Login cancelled")
      return
    }

    res.writeHead(404)
    res.end("Not found")
  })

  return new Promise<void>((resolve, reject) => {
    const onError = (err: Error) => {
      oauthServer = undefined
      reject(err)
    }
    server.once("error", onError)
    server.listen(OAUTH_PORT, OAUTH_HOST, () => {
      server.removeListener("error", onError)
      server.on("error", (err) => logger.warn("microsoft oauth server error", err))
      logger.log("microsoft oauth server started", { host: OAUTH_HOST, port: OAUTH_PORT })
      resolve()
    })
    oauthServer = server
  })
}

function stopOAuthServer() {
  if (oauthServer) {
    oauthServer.close()
    oauthServer = undefined
  }
}

async function runMicrosoftOAuth(serverUrl: string, serverPassword: string): Promise<void> {
  const logger = getLogger()
  const config = resolveMicrosoftConfig()

  try {
    await startOAuthServer()
    const pkce = await generatePKCE()
    const state = generateState()
    const authUrl = buildAuthorizeUrl(config.tenant, pkce, state, config.clientId, config.scopes)

    logger.log("microsoft oauth opening browser", { url: authUrl })

    // Set pending OAuth BEFORE opening browser so the callback can't race ahead
    const tokenPromise = new Promise<TokenResponse>((resolve, reject) => {
      pendingOAuth = { pkce, state, resolve, reject }
    })

    // Open browser for Microsoft login
    const { shell } = await import("electron")
    await shell.openExternal(authUrl)

    const tokens = await tokenPromise

    // Store tokens via server API
    const authPayload = {
      type: "oauth",
      access: tokens.access_token,
      refresh: tokens.refresh_token,
      expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
      ...(tokens.id_token ? { accountId: extractAccountId(tokens) } : {}),
    }

    const res = await fetch(`${serverUrl}/auth/microsoft`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${Buffer.from(`opencode:${serverPassword}`).toString("base64")}`,
      },
      body: JSON.stringify(authPayload),
    })

    if (!res.ok) {
      const detail = await res.text().catch(() => "")
      throw new Error(`Failed to store auth tokens (${res.status}): ${detail}`)
    }

    logger.log("microsoft oauth completed successfully")
  } finally {
    stopOAuthServer()
  }
}

// --- HTML Login Page ---

const HTML_LOGIN = `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>OpenCode Login</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #1a1a2e;
    color: #e0e0e0;
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 100vh;
  }
  .container {
    background: #16213e;
    border-radius: 12px;
    padding: 40px;
    width: 360px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.3);
  }
  h1 {
    font-size: 24px;
    margin-bottom: 8px;
    color: #fff;
  }
  .subtitle {
    color: #8892b0;
    margin-bottom: 32px;
    font-size: 14px;
  }
  .divider {
    display: flex;
    align-items: center;
    gap: 16px;
    margin: 24px 0;
    color: #4a5568;
    font-size: 12px;
  }
  .divider::before, .divider::after {
    content: '';
    flex: 1;
    border-top: 1px solid #2d3748;
  }
  .form-group {
    margin-bottom: 16px;
  }
  label {
    display: block;
    font-size: 13px;
    color: #8892b0;
    margin-bottom: 6px;
  }
  input {
    width: 100%;
    padding: 10px 14px;
    background: #0f3460;
    border: 1px solid #2d3748;
    border-radius: 8px;
    color: #e0e0e0;
    font-size: 14px;
    outline: none;
    transition: border-color 0.2s;
  }
  input:focus {
    border-color: #4361ee;
  }
  .btn {
    width: 100%;
    padding: 12px;
    border: none;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: opacity 0.2s;
  }
  .btn:hover { opacity: 0.9; }
  .btn-admin {
    background: #4361ee;
    color: white;
    margin-top: 8px;
  }
  .btn-microsoft {
    background: #2d3748;
    color: white;
    border: 1px solid #4a5568;
  }
  .btn-microsoft:hover {
    background: #4a5568;
  }
  .error {
    color: #e53e3e;
    font-size: 13px;
    margin-top: 12px;
    display: none;
  }
  .error.visible {
    display: block;
  }
  .loading {
    display: none;
    text-align: center;
    margin-top: 16px;
  }
  .loading.visible {
    display: block;
  }
  .spinner {
    display: inline-block;
    width: 20px;
    height: 20px;
    border: 2px solid #4a5568;
    border-top-color: #4361ee;
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>
<div class="container">
  <h1>OpenCode</h1>
  <p class="subtitle">Sign in to continue</p>

  <button class="btn btn-microsoft" id="microsoftBtn" onclick="startMicrosoft()">
    Sign in with Microsoft
  </button>

  <div class="divider">or</div>

  <form id="adminForm" onsubmit="submitAdmin(event)">
    <div class="form-group">
      <label for="username">Admin username</label>
      <input type="text" id="username" placeholder="admin" autocomplete="username">
    </div>
    <div class="form-group">
      <label for="password">Admin password</label>
      <input type="password" id="password" placeholder="Enter password" autocomplete="current-password">
    </div>
    <button type="submit" class="btn btn-admin" id="adminBtn">Sign in</button>
    <div class="error" id="error"></div>
    <div class="loading" id="loading">
      <div class="spinner"></div>
      <p style="margin-top: 8px; font-size: 13px; color: #8892b0;">Signing in...</p>
    </div>
  </form>
</div>

<script>
  document.addEventListener('DOMContentLoaded', () => {
    if (!window.loginApi) {
      const error = document.getElementById('error')
      const adminBtn = document.getElementById('adminBtn')
      const microsoftBtn = document.getElementById('microsoftBtn')
      error.textContent = 'Preload script failed to load — login API unavailable. Please restart the application.'
      error.classList.add('visible')
      adminBtn.disabled = true
      microsoftBtn.disabled = true
      console.error('loginApi is undefined — preload script may not have loaded')
    }
  })

  async function submitAdmin(event) {
    event.preventDefault()
    const error = document.getElementById('error')
    const loading = document.getElementById('loading')
    const adminBtn = document.getElementById('adminBtn')
    const microsoftBtn = document.getElementById('microsoftBtn')

    const username = document.getElementById('username').value
    const password = document.getElementById('password').value

    error.classList.remove('visible')
    loading.classList.add('visible')
    adminBtn.disabled = true
    microsoftBtn.disabled = true

    try {
      const ok = await window.loginApi.submitAdmin(username, password)
      if (!ok) {
        error.textContent = 'Invalid credentials'
        error.classList.add('visible')
        loading.classList.remove('visible')
        adminBtn.disabled = false
        microsoftBtn.disabled = false
      }
    } catch (e) {
      error.textContent = 'An error occurred. Please try again.'
      error.classList.add('visible')
      loading.classList.remove('visible')
      adminBtn.disabled = false
      microsoftBtn.disabled = false
    }
  }

  async function startMicrosoft() {
    const error = document.getElementById('error')
    const loading = document.getElementById('loading')
    const adminBtn = document.getElementById('adminBtn')
    const microsoftBtn = document.getElementById('microsoftBtn')

    error.classList.remove('visible')
    loading.classList.add('visible')
    adminBtn.disabled = true
    microsoftBtn.disabled = true

    try {
      await window.loginApi.startMicrosoftOAuth()
    } catch (e) {
      error.textContent = e.message || 'Authentication failed'
      error.classList.add('visible')
      loading.classList.remove('visible')
      adminBtn.disabled = false
      microsoftBtn.disabled = false
    }
  }
</script>
</body>
</html>`

const HTML_SUCCESS = `<!DOCTYPE html>
<html><body style="display:flex;justify-content:center;align-items:center;min-height:100vh;background:#1a1a2e;color:#e0e0e0;font-family:sans-serif;">
<h1 style="color:#48bb78;">✓ Authentication successful!</h1>
<p style="color:#8892b0;margin-top:12px;">You can close this window and return to OpenCode.</p>
</body></html>`

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&": return "&amp;"
      case "<": return "&lt;"
      case ">": return "&gt;"
      case '"': return "&quot;"
      case "'": return "&#39;"
      default: return char
    }
  })
}

function extractAccountId(tokens: TokenResponse): string | undefined {
  const extract = (token: string) => {
    try {
      const parts = token.split(".")
      if (parts.length !== 3) return undefined
      const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString())
      return claims.oid ?? claims.sub
    } catch {
      return undefined
    }
  }
  if (tokens.id_token) {
    const id = extract(tokens.id_token)
    if (id) return id
  }
  if (tokens.access_token) {
    const id = extract(tokens.access_token)
    if (id) return id
  }
  return undefined
}

// --- Main Gate ---

export async function enforceDesktopLogin(serverUrl: string, serverPassword: string): Promise<void> {
  const logger = getLogger()

  // 1. Bypass via env var
  if (isBypassEnabled()) {
    logger.log("login bypass active (MICROSOFT_LOGIN_BYPASS)")
    return
  }

  // 2. Check if already has Microsoft auth
  const hasAuth = await checkExistingAuth()
  if (hasAuth) {
    logger.log("existing microsoft auth found, skipping login gate")
    return
  }

  logger.log("no auth found, showing login dialog")

  // 3. Show login dialog
  try {
    await showLoginDialog(serverUrl, serverPassword)
  } catch (error) {
    logger.error("login gate rejected", error instanceof Error ? error.message : String(error))
    // Exit the app — login is required. app.exit() doesn't stop the current tick,
    // so throw to prevent createMainWindow() from running afterward.
    app.exit(1)
    throw error
  }

  logger.log("login gate passed")
}

async function checkExistingAuth(): Promise<boolean> {
  try {
    const fs = await import("node:fs")
    // The auth module stores tokens at Global.Path.data/auth.json
    // which resolves to {XDG_DATA_HOME}/opencode/auth.json.
    // XDG_DATA_HOME defaults to ~/.local/share on Linux, ~/Library/Application Support on macOS,
    // and %APPDATA% on Windows (via the xdg-basedir package).
    const xdgDataHome = process.env["XDG_DATA_HOME"]
    const defaultDataHome =
      process.platform === "darwin"
        ? join(homedir(), "Library", "Application Support")
        : process.platform === "win32"
          ? process.env["APPDATA"] ?? join(homedir(), "AppData", "Roaming")
          : join(homedir(), ".local", "share")
    const dataHome = xdgDataHome ?? defaultDataHome
    const authPath = join(dataHome, "opencode", "auth.json")

    if (fs.existsSync(authPath)) {
      const content = fs.readFileSync(authPath, "utf-8")
      const data = JSON.parse(content)
      if (data?.microsoft?.type === "oauth" && data.microsoft.access && data.microsoft.refresh) {
        return true
      }
    }
  } catch {
    // Ignore read errors
  }
  return false
}

function showLoginDialog(serverUrl: string, serverPassword: string): Promise<void> {
  const logger = getLogger()
  const preloadPath = join(PRELOAD_ROOT, "../preload/login.cjs")
  logger.log("login dialog preload path", { preloadPath, packaged: app.isPackaged })

  return new Promise<void>((resolve, reject) => {
    let resolved = false
    let oauthError: Error | undefined

    const win = new BrowserWindow({
      width: WINDOW_WIDTH,
      height: WINDOW_HEIGHT,
      resizable: false,
      minimizable: false,
      maximizable: false,
      title: "OpenCode - Sign In",
      autoHideMenuBar: true,
      center: true,
      show: false,
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    })

    // Log any preload script failures — critical for diagnosing
    // "window.loginApi is undefined" issues on Windows packaged builds.
    win.webContents.on("preload-error", (_event, failedPath, error) => {
      logger.error("login dialog preload failed", { preloadPath: failedPath, error })
    })

    // IPC handlers for this login window
    const adminHandler = (_event: Electron.IpcMainInvokeEvent, username: string, password: string) => {
      const ok = validateAdmin(username, password)
      if (ok) {
        resolved = true
        cleanup()
        win.close()
        resolve()
      }
      return ok
    }

    const microsoftHandler = async () => {
      try {
        await runMicrosoftOAuth(serverUrl, serverPassword)
        resolved = true
        cleanup()
        win.close()
        resolve()
      } catch (error) {
        oauthError = error instanceof Error ? error : new Error(String(error))
        throw error
      }
    }

    ipcMain.handle("login-admin", adminHandler)
    ipcMain.handle("login-microsoft", microsoftHandler)

    const cleanup = () => {
      try {
        ipcMain.removeHandler("login-admin")
        ipcMain.removeHandler("login-microsoft")
      } catch {
        // ignore
      }
    }

    // Write HTML to a temp file and load it via file:// — loading inline HTML
    // via data:text/html with a preload script is unreliable in Electron 42
    // packaged builds on Windows (the preload may not execute).
    // Using win.loadFile() gives the page a proper file:// origin and avoids
    // the preload-not-running edge case entirely.
    const fs = { writeFileSync, unlinkSync }
    const tmpFile = join(app.getPath("temp"), `opencode-login-${Date.now()}.html`)
    fs.writeFileSync(tmpFile, HTML_LOGIN)

    win.on("closed", () => {
      cleanup()
      if (!resolved) {
        reject(oauthError ?? new Error("Login cancelled"))
      }
      // Clean up temp file
      try { fs.unlinkSync(tmpFile) } catch { /* ignore */ }
    })

    // Load HTML from temp file
    win.loadFile(tmpFile)

    win.once("ready-to-show", () => {
      win.show()
    })
  })
}
