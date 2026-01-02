/**
 * OpenChamber Status Utility
 * Checks if OpenChamber server is running and handles connection state
 */

// Default port for OpenChamber (not 3000 - too commonly used)
const DEFAULT_OPENCHAMBER_PORT = 4097
const OPENCHAMBER_CHECK_TIMEOUT = 2000 // 2 seconds

// Storage keys (namespaced to avoid conflicts with opencode-status)
const OPENCHAMBER_PORT_KEY = "eidorail-openchamber-port"
const OPENCHAMBER_URL_KEY = "eidorail-openchamber-url"
const OPENCHAMBER_MODE_KEY = "eidorail-openchamber-mode" // "local" | "remote"

export type OpenChamberConnectionMode = "local" | "remote"

/**
 * Get OpenChamber connection mode (local port vs remote URL)
 */
export function getOpenChamberConnectionMode(): OpenChamberConnectionMode {
  return (localStorage.getItem(OPENCHAMBER_MODE_KEY) as OpenChamberConnectionMode) || "local"
}

/**
 * Set OpenChamber connection mode
 */
export function setOpenChamberConnectionMode(mode: OpenChamberConnectionMode): void {
  localStorage.setItem(OPENCHAMBER_MODE_KEY, mode)
}

/**
 * Get current configured OpenChamber port (for local mode)
 */
export function getOpenChamberPort(): number {
  return parseInt(localStorage.getItem(OPENCHAMBER_PORT_KEY) || String(DEFAULT_OPENCHAMBER_PORT), 10)
}

/**
 * Save OpenChamber port
 */
export function saveOpenChamberPort(port: number): void {
  localStorage.setItem(OPENCHAMBER_PORT_KEY, String(port))
}

/**
 * Get OpenChamber remote URL (for remote mode)
 */
export function getOpenChamberRemoteUrl(): string {
  return localStorage.getItem(OPENCHAMBER_URL_KEY) || ""
}

/**
 * Set OpenChamber remote URL
 */
export function setOpenChamberRemoteUrl(url: string): void {
  localStorage.setItem(OPENCHAMBER_URL_KEY, url)
}

/**
 * Get the full OpenChamber URL for iframe embedding
 */
export function getOpenChamberUrl(): string {
  if (getOpenChamberConnectionMode() === "remote") {
    return getOpenChamberRemoteUrl()
  }
  return `http://localhost:${getOpenChamberPort()}`
}

/**
 * Check if a specific port has OpenChamber running
 */
async function checkOpenChamberPort(port: number): Promise<boolean> {
  const url = `http://localhost:${port}`

  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(false), OPENCHAMBER_CHECK_TIMEOUT)

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
 * Check if OpenChamber server is reachable
 */
export async function checkOpenChamberStatus(): Promise<boolean> {
  const mode = getOpenChamberConnectionMode()

  if (mode === "remote") {
    const remoteUrl = getOpenChamberRemoteUrl()
    if (!remoteUrl) return false

    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(false), OPENCHAMBER_CHECK_TIMEOUT)
      fetch(remoteUrl, { mode: "no-cors", cache: "no-store" })
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

  // Local mode: check configured port
  const port = getOpenChamberPort()
  return checkOpenChamberPort(port)
}

/**
 * Retry OpenChamber connection with delays between attempts
 */
export async function retryOpenChamberConnection(
  maxRetries: number,
  onAttempt?: (attempt: number) => void,
): Promise<boolean> {
  for (let i = 0; i < maxRetries; i++) {
    onAttempt?.(i + 1)

    if (await checkOpenChamberStatus()) {
      return true
    }

    // Wait before next retry (500ms, 1000ms, 1500ms)
    if (i < maxRetries - 1) {
      await new Promise((resolve) => setTimeout(resolve, 500 * (i + 1)))
    }
  }

  return false
}

/**
 * Get the command to start OpenChamber
 */
export function getStartCommand(): string {
  const port = getOpenChamberPort()
  return `openchamber --port ${port}`
}
