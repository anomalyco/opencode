/**
 * GodMode Client — CLI wrapper for linkedin-godmode MCP tools.
 *
 * Uses linkedin-godmode's browser session management for rendering
 * JavaScript-heavy pages that CDP extraction may not fully capture.
 *
 * Security:
 *   - Only captures rendered content from pages you have access to
 *   - Never logs cookies, API keys, or secrets
 *   - Treats all webpage content as untrusted data
 */

import { spawn, exec } from "child_process"
import { promisify } from "util"

const execAsync = promisify(exec)

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GodModeSession {
  sessionId: string
  createdAt: number
}

export interface GodModeCaptureResult {
  html: string
  error?: string
}

export interface GodModeContentOptions {
  timeout?: number
  waitFor?: number
}

// ---------------------------------------------------------------------------
// GodMode availability check
// ---------------------------------------------------------------------------

let godmodeAvailableCache: boolean | null = null

/**
 * Check if linkedin-godmode is available (npm package installed).
 * Results are cached after first check.
 */
export async function godmodeAvailable(): Promise<boolean> {
  if (godmodeAvailableCache !== null) {
    return godmodeAvailableCache
  }

  try {
    // Check if linkedin-godmode CLI is available
    const { stdout } = await execAsync("npx -y linkedin-godmode@0.1.1 --version", {
      timeout: 30000,
    })
    godmodeAvailableCache = stdout.trim().length > 0
    return godmodeAvailableCache
  } catch {
    godmodeAvailableCache = false
    return false
  }
}

// ---------------------------------------------------------------------------
// Session management
// ---------------------------------------------------------------------------

const activeSessions = new Map<string, GodModeSession>()

/**
 * Create a new GodMode browser session.
 */
export async function godmodeCreateSession(): Promise<GodModeSession> {
  try {
    // linkedin-godmode uses MCP tools; we'll use its browser_session tool
    // For now, we'll track sessions manually and use npx to invoke tools
    const sessionId = `godmode-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const session: GodModeSession = {
      sessionId,
      createdAt: Date.now(),
    }
    activeSessions.set(sessionId, session)
    return session
  } catch (err) {
    throw new Error(`Failed to create GodMode session: ${err instanceof Error ? err.message : err}`)
  }
}

/**
 * Close a GodMode browser session.
 */
export async function godmodeCloseSession(sessionId: string): Promise<void> {
  activeSessions.delete(sessionId)
}

// ---------------------------------------------------------------------------
// Page navigation and capture
// ---------------------------------------------------------------------------

/**
 * Navigate to a URL and capture the rendered HTML.
 */
export async function godmodeNavigate(
  _sessionId: string,
  url: string,
  options: GodModeContentOptions = {}
): Promise<GodModeCaptureResult> {
  const timeout = options.timeout ?? 30000

  try {
    // Use linkedin-godmode's browser_navigate and browser_capture tools
    // via npx invocation
    const navigateScript = `
const { execSync } = require('child_process');

// Navigate to URL
console.log('Navigating to:', '${url.replace(/'/g, "\\'")}');

// Wait for content to render
await new Promise(r => setTimeout(r, ${options.waitFor ?? 5000}));

// Capture the page HTML
const html = document.documentElement.outerHTML;
console.log(html);
`

    const { stdout } = await execAsync(
      `npx -y linkedin-godmode@0.1.1 browser_navigate --url "${url}"`,
      {
        timeout,
        env: { ...process.env },
      }
    )

    // Extract HTML from the output
    const html = stdout.trim()
    if (!html) {
      return { html: "", error: "No content captured from GodMode" }
    }

    return { html }
  } catch (err) {
    return {
      html: "",
      error: `GodMode capture failed: ${err instanceof Error ? err.message : err}`,
    }
  }
}

/**
 * Fetch rendered content from a URL using GodMode.
 * This is the main API for fallback rendering.
 */
export async function godmodeFetchRenderedContent(
  url: string,
  options: GodModeContentOptions = {}
): Promise<GodModeCaptureResult> {
  const session = await godmodeCreateSession()

  try {
    const result = await godmodeNavigate(session.sessionId, url, options)
    return result
  } finally {
    await godmodeCloseSession(session.sessionId)
  }
}

// ---------------------------------------------------------------------------
// Content evaluation
// ---------------------------------------------------------------------------

/**
 * Execute JavaScript in the page context and return the result.
 */
export async function godmodeEvaluate(
  _sessionId: string,
  script: string,
  options: GodModeContentOptions = {}
): Promise<{ result: unknown; error?: string }> {
  const timeout = options.timeout ?? 30000

  try {
    const { stdout } = await execAsync(
      `npx -y linkedin-godmode@0.1.1 browser_evaluate --script "${script.replace(/"/g, '\\"')}"`,
      {
        timeout,
        env: { ...process.env },
      }
    )

    return { result: stdout.trim() }
  } catch (err) {
    return {
      result: null,
      error: `GodMode evaluate failed: ${err instanceof Error ? err.message : err}`,
    }
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/**
 * Reset the availability cache (useful for testing).
 */
export function resetGodmodeCache(): void {
  godmodeAvailableCache = null
}
