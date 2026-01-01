/**
 * OpenCode Status Utility
 * Checks if OpenCode server is running and handles connection state
 */

export type ConnectionStatus = "checking" | "connected" | "disconnected"

// Default port for CLI users
const DEFAULT_PORT = 4096
// Desktop app uses ephemeral ports in this range
const PORT_SCAN_START = 44000
const PORT_SCAN_END = 47000
const PORT_SCAN_STEP = 50 // Check every 50th port for speed
const CHECK_TIMEOUT = 1000 // 1 second per port

// Storage keys
const PORT_STORAGE_KEY = "eidorail-opencode-port"
const URL_STORAGE_KEY = "eidorail-opencode-url"
const MODE_STORAGE_KEY = "eidorail-opencode-mode" // "local" | "remote"

export type ConnectionMode = "local" | "remote"

/**
 * Get connection mode (local port scanning vs remote URL)
 */
export function getConnectionMode(): ConnectionMode {
  return (localStorage.getItem(MODE_STORAGE_KEY) as ConnectionMode) || "local"
}

/**
 * Set connection mode
 */
export function setConnectionMode(mode: ConnectionMode): void {
  localStorage.setItem(MODE_STORAGE_KEY, mode)
}

/**
 * Get current configured port (for local mode)
 */
export function getOpenCodePort(): number {
  return parseInt(localStorage.getItem(PORT_STORAGE_KEY) || String(DEFAULT_PORT), 10)
}

/**
 * Save a discovered working port
 */
export function saveOpenCodePort(port: number): void {
  localStorage.setItem(PORT_STORAGE_KEY, String(port))
}

/**
 * Get remote URL (for remote mode)
 */
export function getRemoteUrl(): string {
  return localStorage.getItem(URL_STORAGE_KEY) || ""
}

/**
 * Set remote URL
 */
export function setRemoteUrl(url: string): void {
  localStorage.setItem(URL_STORAGE_KEY, url)
}

const WORKSPACE_KEY = "eidorail-workspace"
const WORKSPACE_ENABLED_KEY = "eidorail-workspace-enabled"

export function getWorkspaceDirectory(): string {
  return localStorage.getItem(WORKSPACE_KEY) || ""
}

export function setWorkspaceDirectory(path: string): void {
  localStorage.setItem(WORKSPACE_KEY, path)
}

export function isWorkspaceEnabled(): boolean {
  return localStorage.getItem(WORKSPACE_ENABLED_KEY) === "true"
}

export function setWorkspaceEnabled(enabled: boolean): void {
  localStorage.setItem(WORKSPACE_ENABLED_KEY, String(enabled))
}

function base64Encode(str: string): string {
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

export function getOpenCodeUrl(): string {
  let baseUrl: string
  if (getConnectionMode() === "remote") {
    baseUrl = getRemoteUrl()
  } else {
    baseUrl = `http://localhost:${getOpenCodePort()}`
  }

  let path = ""
  if (isWorkspaceEnabled()) {
    const workspace = getWorkspaceDirectory()
    if (workspace) {
      const encodedPath = base64Encode(workspace)
      path = `/${encodedPath}/session`
    }
  }

  return `${baseUrl}${path}?eidorail=compact`
}

/**
 * Check if a specific port has OpenCode running
 * Returns true if server responds (even with CORS error)
 */
async function checkPort(port: number): Promise<boolean> {
  const url = `http://localhost:${port}`

  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(false), CHECK_TIMEOUT)

    fetch(url, { mode: "no-cors", cache: "no-store" })
      .then(() => {
        clearTimeout(timeout)
        resolve(true)
      })
      .catch(() => {
        clearTimeout(timeout)
        resolve(false)
      })
  })
}

/**
 * Scan port range to find OpenCode
 * Returns port number if found, null otherwise
 */
async function scanForOpenCode(): Promise<number | null> {
  // First try default port (for CLI users)
  if (await checkPort(DEFAULT_PORT)) {
    return DEFAULT_PORT
  }

  // Scan ephemeral port range in batches for Desktop app
  const batchSize = 10
  for (let start = PORT_SCAN_START; start < PORT_SCAN_END; start += batchSize * PORT_SCAN_STEP) {
    const ports = []
    for (let i = 0; i < batchSize && start + i * PORT_SCAN_STEP < PORT_SCAN_END; i++) {
      ports.push(start + i * PORT_SCAN_STEP)
    }

    // Check batch in parallel
    const results = await Promise.all(ports.map(async (port) => ({ port, ok: await checkPort(port) })))
    const found = results.find((r) => r.ok)
    if (found) {
      return found.port
    }
  }

  return null
}

/**
 * Check if a URL is reachable
 */
export async function checkUrl(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(false), CHECK_TIMEOUT)

    fetch(url, { mode: "no-cors", cache: "no-store" })
      .then(() => {
        clearTimeout(timeout)
        resolve(true)
      })
      .catch(() => {
        clearTimeout(timeout)
        resolve(false)
      })
  })
}

/**
 * Check if OpenCode server is reachable
 * Handles both local (port scanning) and remote (URL) modes
 */
export async function checkOpenCodeStatus(): Promise<boolean> {
  const mode = getConnectionMode()

  if (mode === "remote") {
    const remoteUrl = getRemoteUrl()
    if (!remoteUrl) return false
    return checkUrl(remoteUrl)
  }

  // Local mode: try saved port first
  const savedPort = getOpenCodePort()
  if (await checkPort(savedPort)) {
    return true
  }

  // Scan for OpenCode on other ports
  const foundPort = await scanForOpenCode()
  if (foundPort) {
    saveOpenCodePort(foundPort)
    return true
  }

  return false
}

/**
 * Manually trigger a port scan and return the found port
 */
export async function manualPortScan(): Promise<number | null> {
  return scanForOpenCode()
}

/**
 * Retry connection with delays between attempts
 * Returns true if connected, false if all retries exhausted
 */
export async function retryConnection(
  maxRetries: number,
  onAttempt?: (attempt: number, total: number) => void,
): Promise<boolean> {
  for (let i = 0; i < maxRetries; i++) {
    onAttempt?.(i + 1, maxRetries)

    if (await checkOpenCodeStatus()) {
      return true
    }

    // Wait before next retry (500ms, 1000ms, 1500ms)
    if (i < maxRetries - 1) {
      await new Promise((resolve) => setTimeout(resolve, 500 * (i + 1)))
    }
  }

  return false
}
