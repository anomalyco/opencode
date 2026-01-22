import path from "path"
import { Global } from "../global"
import fs from "fs/promises"
import { Log } from "../util/log"
import { generatePKCE } from "@openauthjs/openauth/pkce"

const log = Log.create({ service: "auth.browser" })

/**
 * Install puppeteer and download Chromium automatically
 */
async function installPuppeteer(onProgress?: (msg: string) => void): Promise<boolean> {
  const report = onProgress ?? ((msg: string) => log.info(msg))

  report("Installing puppeteer for browser automation...")

  try {
    const dataDir = Global.Path.data
    const puppeteerDir = path.join(dataDir, "puppeteer")
    await fs.mkdir(puppeteerDir, { recursive: true })

    // Create a minimal package.json for puppeteer
    const pkgPath = path.join(puppeteerDir, "package.json")
    await fs.writeFile(
      pkgPath,
      JSON.stringify(
        {
          name: "opencode-puppeteer",
          private: true,
          dependencies: {
            puppeteer: "^24.9.0",
            "puppeteer-extra": "^3.3.6",
            "puppeteer-extra-plugin-stealth": "^2.11.2",
          },
        },
        null,
        2,
      ),
    )

    report("Installing puppeteer packages (this may take a moment)...")

    // Install puppeteer using bun or npm
    const proc = Bun.spawn(["bun", "install"], {
      cwd: puppeteerDir,
      stdout: "pipe",
      stderr: "pipe",
    })

    const exitCode = await proc.exited
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text()
      log.error("Failed to install puppeteer package", { stderr })

      // Try with npm as fallback
      report("Trying with npm...")
      const npmProc = Bun.spawn(["npm", "install"], {
        cwd: puppeteerDir,
        stdout: "pipe",
        stderr: "pipe",
      })
      const npmExit = await npmProc.exited
      if (npmExit !== 0) {
        return false
      }
    }

    report("Puppeteer installation complete!")
    return true
  } catch (error) {
    log.error("Failed to install puppeteer", { error })
    return false
  }
}

/**
 * Get puppeteer-extra with stealth plugin
 */
async function getPuppeteer(onProgress?: (msg: string) => void) {
  // First try to import from normal node_modules
  try {
    const puppeteerExtra = await import("puppeteer-extra")
    const stealthPlugin = await import("puppeteer-extra-plugin-stealth")
    puppeteerExtra.default.use(stealthPlugin.default())
    return puppeteerExtra.default
  } catch {
    // Not in normal path
  }

  // Try from our custom install location
  const puppeteerDir = path.join(Global.Path.data, "puppeteer")
  const puppeteerExtraPath = path.join(puppeteerDir, "node_modules", "puppeteer-extra")
  const stealthPath = path.join(puppeteerDir, "node_modules", "puppeteer-extra-plugin-stealth")

  try {
    const puppeteerExtra = await import(puppeteerExtraPath)
    const stealthPlugin = await import(stealthPath)
    puppeteerExtra.default.use(stealthPlugin.default())
    return puppeteerExtra.default
  } catch {
    // Not installed yet
  }

  return null
}

/**
 * Ensure puppeteer is available, installing if necessary
 */
async function ensurePuppeteer(onProgress?: (msg: string) => void) {
  let puppeteer = await getPuppeteer(onProgress)

  if (!puppeteer) {
    const installed = await installPuppeteer(onProgress)
    if (!installed) {
      throw new Error(
        "Failed to install puppeteer automatically. Please install it manually:\n" +
          "  npm install puppeteer puppeteer-extra puppeteer-extra-plugin-stealth",
      )
    }

    // Try to load again from our install location
    const puppeteerDir = path.join(Global.Path.data, "puppeteer")
    const puppeteerExtraPath = path.join(puppeteerDir, "node_modules", "puppeteer-extra")
    const stealthPath = path.join(puppeteerDir, "node_modules", "puppeteer-extra-plugin-stealth")

    try {
      const puppeteerExtra = await import(puppeteerExtraPath)
      const stealthPlugin = await import(stealthPath)
      puppeteerExtra.default.use(stealthPlugin.default())
      puppeteer = puppeteerExtra.default
    } catch (e) {
      throw new Error("Puppeteer was installed but could not be loaded. Please restart and try again.")
    }
  }

  return puppeteer
}

const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e"
const ANTHROPIC_OAUTH_AUTHORIZE = "https://claude.ai/oauth/authorize"
const ANTHROPIC_OAUTH_TOKEN = "https://console.anthropic.com/v1/oauth/token"
const OAUTH_CALLBACK = "https://console.anthropic.com/oauth/code/callback"
const OAUTH_CALLBACK_ALT = "https://platform.claude.com/oauth/code/callback"

// Lock to prevent concurrent browser operations on same profile
const browserLocks = new Map<string, Promise<any>>()

export interface OAuthTokens {
  access: string
  refresh: string
  expires: number
}

export interface BrowserSessionStatus {
  recordId: string
  enabled: boolean
  profilePath: string
  lastRefresh?: number
  lastError?: string
  isConfigured: boolean
}

export namespace AuthBrowser {
  function getBrowsersDir(): string {
    return path.join(Global.Path.data, "browsers", "anthropic")
  }

  function getProfilePath(recordId: string): string {
    return path.join(getBrowsersDir(), recordId)
  }

  async function ensureDir(dir: string): Promise<void> {
    await fs.mkdir(dir, { recursive: true })
  }

  /**
   * Check if a browser session is configured for a record
   */
  export async function isConfigured(recordId: string): Promise<boolean> {
    const profilePath = getProfilePath(recordId)
    try {
      const stat = await fs.stat(profilePath)
      return stat.isDirectory()
    } catch {
      return false
    }
  }

  /**
   * Get status of browser session for a record
   */
  export async function status(recordId: string): Promise<BrowserSessionStatus> {
    const profilePath = getProfilePath(recordId)
    const configured = await isConfigured(recordId)

    const metaPath = path.join(profilePath, ".opencode-meta.json")
    let meta: { lastRefresh?: number; lastError?: string } = {}

    if (configured) {
      try {
        const raw = await fs.readFile(metaPath, "utf-8")
        meta = JSON.parse(raw)
      } catch {
        // No meta file yet
      }
    }

    return {
      recordId,
      enabled: configured,
      profilePath,
      lastRefresh: meta.lastRefresh,
      lastError: meta.lastError,
      isConfigured: configured,
    }
  }

  /**
   * Get status of all browser sessions
   */
  export async function listAll(): Promise<BrowserSessionStatus[]> {
    const browsersDir = getBrowsersDir()
    try {
      const entries = await fs.readdir(browsersDir, { withFileTypes: true })
      const sessions: BrowserSessionStatus[] = []

      for (const entry of entries) {
        if (entry.isDirectory()) {
          sessions.push(await status(entry.name))
        }
      }

      return sessions
    } catch {
      return []
    }
  }

  /**
   * Update session metadata
   */
  async function updateMeta(recordId: string, update: { lastRefresh?: number; lastError?: string }): Promise<void> {
    const profilePath = getProfilePath(recordId)
    const metaPath = path.join(profilePath, ".opencode-meta.json")

    let meta: { lastRefresh?: number; lastError?: string } = {}
    try {
      const raw = await fs.readFile(metaPath, "utf-8")
      meta = JSON.parse(raw)
    } catch {
      // No existing meta
    }

    meta = { ...meta, ...update }
    await fs.writeFile(metaPath, JSON.stringify(meta, null, 2))
  }

  /**
   * Safely close browser, force-killing if necessary
   */
  async function closeBrowserSafely(browser: any, profilePath: string): Promise<void> {
    if (!browser) return

    try {
      // Set a timeout for browser.close()
      await Promise.race([
        browser.close(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Browser close timeout")), 5000)),
      ])
    } catch {
      // Force kill if close fails or times out
      log.warn("Browser close failed, force killing", { profilePath })
      try {
        const { execSync } = await import("child_process")
        execSync(`pkill -f "${profilePath}"`, { stdio: "ignore" })
      } catch {
        // Ignore pkill errors
      }
    }
  }

  /**
   * Setup a new browser session for an account.
   * Opens a visible browser for user to log in.
   * Returns a promise that resolves when login is complete.
   * @param onProgress - Optional callback for progress messages
   */
  export async function setup(recordId: string, onProgress?: (msg: string) => void): Promise<OAuthTokens> {
    log.info("setting up browser session", { recordId })

    const profilePath = getProfilePath(recordId)
    await ensureDir(profilePath)

    // Ensure puppeteer is available (auto-installs if needed)
    const puppeteer = await ensurePuppeteer(onProgress)

    onProgress?.("Opening browser window...")

    const browser = await puppeteer.launch({
      headless: false, // User needs to see the browser to log in
      userDataDir: profilePath,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-blink-features=AutomationControlled",
        "--window-size=1280,800",
      ],
    })

    const page = await browser.newPage()
    await page.setViewport({ width: 1280, height: 800 })

    // Generate PKCE for OAuth
    const pkce = await generatePKCE()

    // Build authorize URL
    const authorizeUrl = new URL(ANTHROPIC_OAUTH_AUTHORIZE)
    authorizeUrl.searchParams.set("code", "true")
    authorizeUrl.searchParams.set("client_id", CLIENT_ID)
    authorizeUrl.searchParams.set("response_type", "code")
    authorizeUrl.searchParams.set("redirect_uri", OAUTH_CALLBACK)
    authorizeUrl.searchParams.set("scope", "org:create_api_key user:profile user:inference")
    authorizeUrl.searchParams.set("code_challenge", pkce.challenge)
    authorizeUrl.searchParams.set("code_challenge_method", "S256")
    authorizeUrl.searchParams.set("state", pkce.verifier)

    log.info("navigating to authorize URL", { url: authorizeUrl.toString() })
    await page.goto(authorizeUrl.toString(), { waitUntil: "networkidle0", timeout: 60000 })

    // Wait for user to complete login and be redirected to callback
    log.info("waiting for user to complete login...")

    try {
      // Poll for URL change - more reliable than waitForFunction across navigations
      const startTime = Date.now()
      const timeoutMs = 600000 // 10 minutes for user to log in (email verification can take time)
      let code: string | null = null

      while (Date.now() - startTime < timeoutMs) {
        await new Promise((resolve) => setTimeout(resolve, 1000)) // Check every second

        try {
          const currentUrl = page.url()

          // Check both callback URLs - console.anthropic.com and platform.claude.com
          if (
            currentUrl.includes(OAUTH_CALLBACK) ||
            currentUrl.includes(OAUTH_CALLBACK_ALT) ||
            currentUrl.includes("/oauth/code/callback")
          ) {
            log.info("detected callback URL", { currentUrl })

            // Code can be in hash or query params
            const urlObj = new URL(currentUrl)
            if (urlObj.hash) {
              const hashParams = new URLSearchParams(urlObj.hash.substring(1))
              code = hashParams.get("code")
            }
            if (!code) {
              code = urlObj.searchParams.get("code")
            }

            if (code) {
              log.info("found authorization code")
              break
            }
          }
        } catch {
          // Page might be navigating, ignore errors and retry
        }
      }

      if (!code) {
        throw new Error("Login timed out. Please try again.")
      }

      log.info("authorization code received, exchanging for tokens")

      // Exchange code for tokens
      const tokens = await exchangeCodeForTokens(code, pkce.verifier)

      await updateMeta(recordId, { lastRefresh: Date.now(), lastError: undefined })

      log.info("browser session setup complete", { recordId })

      await closeBrowserSafely(browser, profilePath)

      return tokens
    } catch (error) {
      await closeBrowserSafely(browser, profilePath)
      const message = error instanceof Error ? error.message : String(error)
      await updateMeta(recordId, { lastError: message })
      throw error
    }
  }

  /**
   * Refresh tokens using existing browser session (headless).
   * Browser must already have a valid session from setup().
   */
  export async function refresh(recordId: string): Promise<OAuthTokens> {
    log.info("refreshing tokens via browser session", { recordId })

    // Wait for any existing operation on this profile to complete
    const existingLock = browserLocks.get(recordId)
    if (existingLock) {
      log.info("waiting for existing browser operation to complete", { recordId })
      try {
        await existingLock
      } catch {
        // Previous operation failed, continue with our attempt
      }
    }

    // Create our lock
    let resolveLock: () => void
    const lock = new Promise<void>((resolve) => {
      resolveLock = resolve
    })
    browserLocks.set(recordId, lock)

    try {
      return await doRefresh(recordId)
    } finally {
      resolveLock!()
      browserLocks.delete(recordId)
    }
  }

  async function doRefresh(recordId: string): Promise<OAuthTokens> {
    const configured = await isConfigured(recordId)
    if (!configured) {
      throw new Error(`No browser session configured for record ${recordId}. Run setup first.`)
    }

    const profilePath = getProfilePath(recordId)

    // Kill any existing Chrome processes using this profile
    try {
      const lockFile = path.join(profilePath, "SingletonLock")
      await fs.rm(lockFile, { force: true })
    } catch {
      // Lock file might not exist
    }

    // Ensure puppeteer is available
    const puppeteer = await ensurePuppeteer()

    let browser
    try {
      browser = await puppeteer.launch({
        headless: true, // Run headless for auto-refresh
        userDataDir: profilePath,
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-blink-features=AutomationControlled"],
      })
    } catch (launchError) {
      const msg = launchError instanceof Error ? launchError.message : String(launchError)
      if (msg.includes("already running") || msg.includes("SingletonLock")) {
        log.warn("Browser profile locked, attempting to kill stale processes", { recordId })
        // Try to kill any chrome processes and retry
        try {
          const { execSync } = await import("child_process")
          execSync(`pkill -f "${profilePath}"`, { stdio: "ignore" })
          await new Promise((r) => setTimeout(r, 1000))
        } catch {
          // pkill might fail if no matching processes
        }
        // Retry launch
        browser = await puppeteer.launch({
          headless: true,
          userDataDir: profilePath,
          args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-blink-features=AutomationControlled"],
        })
      } else {
        throw launchError
      }
    }

    const page = await browser.newPage()
    await page.setViewport({ width: 1280, height: 800 })

    // Generate PKCE for OAuth
    const pkce = await generatePKCE()

    // Build authorize URL
    const authorizeUrl = new URL(ANTHROPIC_OAUTH_AUTHORIZE)
    authorizeUrl.searchParams.set("code", "true")
    authorizeUrl.searchParams.set("client_id", CLIENT_ID)
    authorizeUrl.searchParams.set("response_type", "code")
    authorizeUrl.searchParams.set("redirect_uri", OAUTH_CALLBACK)
    authorizeUrl.searchParams.set("scope", "org:create_api_key user:profile user:inference")
    authorizeUrl.searchParams.set("code_challenge", pkce.challenge)
    authorizeUrl.searchParams.set("code_challenge_method", "S256")
    authorizeUrl.searchParams.set("state", pkce.verifier)

    log.info("navigating to authorize URL (headless)", { url: authorizeUrl.toString() })

    try {
      await page.goto(authorizeUrl.toString(), { waitUntil: "networkidle0", timeout: 60000 })

      // If session is valid, we might land on consent screen - auto-click Authorize
      // Poll for URL change and auto-click authorize button if present
      const startTime = Date.now()
      const timeoutMs = 60000 // 1 minute for auto-redirect
      let code: string | null = null
      let clickedAuthorize = false

      while (Date.now() - startTime < timeoutMs) {
        await new Promise((resolve) => setTimeout(resolve, 500)) // Check every 500ms

        try {
          const currentUrl = page.url()

          // Check both callback URLs
          if (
            currentUrl.includes(OAUTH_CALLBACK) ||
            currentUrl.includes(OAUTH_CALLBACK_ALT) ||
            currentUrl.includes("/oauth/code/callback")
          ) {
            log.info("detected callback URL", { currentUrl })

            const urlObj = new URL(currentUrl)
            if (urlObj.hash) {
              const hashParams = new URLSearchParams(urlObj.hash.substring(1))
              code = hashParams.get("code")
            }
            if (!code) {
              code = urlObj.searchParams.get("code")
            }

            if (code) break
          }

          // Try to click "Authorize" button if we're on consent screen
          if (!clickedAuthorize && currentUrl.includes("claude.ai")) {
            try {
              // Try multiple selectors for the authorize button
              const clicked = await page.evaluate(() => {
                // Find button with text "Authorize"
                const buttons = Array.from(document.querySelectorAll("button"))
                for (const btn of buttons) {
                  if (btn.textContent?.trim() === "Authorize" || btn.textContent?.includes("Authorize")) {
                    btn.click()
                    return true
                  }
                }
                // Also try input submit buttons
                const inputs = Array.from(document.querySelectorAll('input[type="submit"]'))
                for (const input of inputs) {
                  if ((input as HTMLInputElement).value?.includes("Authorize")) {
                    ;(input as HTMLInputElement).click()
                    return true
                  }
                }
                return false
              })
              if (clicked) {
                log.info("clicked authorize button")
                clickedAuthorize = true
                await new Promise((resolve) => setTimeout(resolve, 2000)) // Wait for redirect
              }
            } catch {
              // Button not found or click failed, continue polling
            }
          }
        } catch {
          // Page might be navigating
        }
      }

      if (!code) {
        throw new Error("Session expired or refresh timed out. Please run setup again.")
      }

      log.info("authorization code received, exchanging for tokens")

      const tokens = await exchangeCodeForTokens(code, pkce.verifier)

      await updateMeta(recordId, { lastRefresh: Date.now(), lastError: undefined })

      log.info("token refresh complete", { recordId })

      await closeBrowserSafely(browser, profilePath)

      return tokens
    } catch (error) {
      await closeBrowserSafely(browser, profilePath)
      const message = error instanceof Error ? error.message : String(error)
      log.error("browser refresh failed", { recordId, error: message })
      await updateMeta(recordId, { lastError: message })

      // If refresh fails, session might be expired - user needs to setup again
      if (message.includes("Timeout") || message.includes("timeout")) {
        throw new Error(
          `Browser session expired for record ${recordId}. Please run 'opencode auth browser setup' again.`,
        )
      }

      throw error
    }
  }

  /**
   * Remove browser session for a record
   */
  export async function remove(recordId: string): Promise<void> {
    log.info("removing browser session", { recordId })
    const profilePath = getProfilePath(recordId)

    try {
      await fs.rm(profilePath, { recursive: true, force: true })
      log.info("browser session removed", { recordId })
    } catch (error) {
      log.error("failed to remove browser session", { recordId, error })
      throw error
    }
  }

  /**
   * Exchange authorization code for tokens
   */
  async function exchangeCodeForTokens(code: string, verifier: string): Promise<OAuthTokens> {
    // Handle code that might have state appended (code#state format)
    const cleanCode = code.split("#")[0]

    const response = await fetch(ANTHROPIC_OAUTH_TOKEN, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        code: cleanCode,
        state: verifier,
        grant_type: "authorization_code",
        client_id: CLIENT_ID,
        redirect_uri: OAUTH_CALLBACK,
        code_verifier: verifier,
      }),
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Token exchange failed: ${response.status} - ${text}`)
    }

    const json = await response.json()

    return {
      access: json.access_token,
      refresh: json.refresh_token,
      expires: Date.now() + json.expires_in * 1000,
    }
  }
}
