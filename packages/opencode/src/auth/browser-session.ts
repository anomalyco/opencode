import path from "path"
import fs from "fs/promises"
import { Global } from "@opencode-ai/core/global"
import * as Log from "@opencode-ai/core/util/log"
import { generatePKCE } from "@openauthjs/openauth/pkce"
import { ensurePuppeteer } from "./browser-puppeteer"
import { isValidRecordId } from "./browser"

const log = Log.create({ service: "auth.browser.session" })

const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e"
const ANTHROPIC_OAUTH_AUTHORIZE = "https://claude.ai/oauth/authorize"
const ANTHROPIC_OAUTH_TOKEN = "https://console.anthropic.com/v1/oauth/token"
const OAUTH_CALLBACK = "https://console.anthropic.com/oauth/code/callback"
const OAUTH_CALLBACK_ALT = "https://platform.claude.com/oauth/code/callback"
const BROWSER_LAUNCH_TIMEOUT_MS = 30000

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

// Per-profile lock to prevent concurrent browser operations
const browserLocks = new Map<string, Promise<any>>()

function getBrowsersDir(): string {
  return path.join(Global.Path.data, "browsers", "anthropic")
}

function getProfilePath(recordId: string): string {
  if (!isValidRecordId(recordId)) {
    throw new Error(`Invalid recordId: ${JSON.stringify(recordId)}`)
  }
  const browsersDir = getBrowsersDir()
  const resolved = path.resolve(browsersDir, recordId)
  if (!resolved.startsWith(browsersDir + path.sep) && resolved !== browsersDir) {
    throw new Error(`recordId escapes browsers directory: ${JSON.stringify(recordId)}`)
  }
  return resolved
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true })
}

async function updateMeta(recordId: string, update: { lastRefresh?: number; lastError?: string }): Promise<void> {
  const profilePath = getProfilePath(recordId)
  const metaPath = path.join(profilePath, ".opencode-meta.json")
  let meta: { lastRefresh?: number; lastError?: string } = {}
  try {
    meta = JSON.parse(await fs.readFile(metaPath, "utf-8"))
  } catch {}
  await fs.writeFile(metaPath, JSON.stringify({ ...meta, ...update }, null, 2))
}

async function launchBrowserWithTimeout(puppeteer: any, options: any): Promise<any> {
  return Promise.race([
    puppeteer.launch(options),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Browser launch timed out after ${BROWSER_LAUNCH_TIMEOUT_MS}ms`)), BROWSER_LAUNCH_TIMEOUT_MS),
    ),
  ])
}

async function killExistingBrowser(profilePath: string): Promise<void> {
  const profileName = path.basename(profilePath)
  log.info("killing existing browser for profile", { profileName })

  try {
    await fs.rm(path.join(profilePath, "SingletonLock"), { force: true })
  } catch {}

  try {
    const { spawnSync } = await import("child_process")
    if (process.platform === "darwin" || process.platform === "linux") {
      spawnSync("pkill", ["-9", "-f", profileName], { stdio: "ignore" })
    } else if (process.platform === "win32") {
      spawnSync("taskkill", ["/F", "/IM", "chrome.exe", "/FI", `COMMANDLINE eq *${profileName}*`], { stdio: "ignore" })
    }
    await new Promise((r) => setTimeout(r, 500))
  } catch {}

  try {
    for (const file of ["SingletonLock", "SingletonCookie", "SingletonSocket"]) {
      await fs.rm(path.join(profilePath, file), { force: true }).catch(() => {})
    }
  } catch {}
}

async function closeBrowserSafely(browser: any, profilePath: string): Promise<void> {
  if (!browser) return
  try {
    await Promise.race([
      browser.close(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Browser close timeout")), 5000)),
    ])
  } catch (closeError) {
    log.warn("Browser close failed, force killing", { profilePath, error: String(closeError) })
    try {
      const browserProcess = browser.process?.()
      if (browserProcess && !browserProcess.killed) browserProcess.kill("SIGKILL")
    } catch {}
    try {
      const { spawnSync } = await import("child_process")
      spawnSync("pkill", ["-9", "-f", `chrome.*${path.basename(profilePath)}`], { stdio: "ignore" })
    } catch {}
    try {
      await fs.rm(path.join(profilePath, "SingletonLock"), { force: true })
    } catch {}
  }
}

async function exchangeCodeForTokens(code: string, verifier: string): Promise<OAuthTokens> {
  const cleanCode = code.split("#")[0]
  const response = await fetch(ANTHROPIC_OAUTH_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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

function buildAuthorizeUrl(pkce: { challenge: string; verifier: string }): URL {
  const url = new URL(ANTHROPIC_OAUTH_AUTHORIZE)
  url.searchParams.set("code", "true")
  url.searchParams.set("client_id", CLIENT_ID)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("redirect_uri", OAUTH_CALLBACK)
  url.searchParams.set("scope", "org:create_api_key user:profile user:inference")
  url.searchParams.set("code_challenge", pkce.challenge)
  url.searchParams.set("code_challenge_method", "S256")
  url.searchParams.set("state", pkce.verifier)
  return url
}

async function extractCodeFromCallbackUrl(page: any): Promise<string | null> {
  const currentUrl = page.url()
  if (
    !currentUrl.includes(OAUTH_CALLBACK) &&
    !currentUrl.includes(OAUTH_CALLBACK_ALT) &&
    !currentUrl.includes("/oauth/code/callback")
  ) {
    return null
  }
  const urlObj = new URL(currentUrl)
  if (urlObj.hash) {
    const code = new URLSearchParams(urlObj.hash.substring(1)).get("code")
    if (code) return code
  }
  return urlObj.searchParams.get("code")
}

export namespace AuthBrowser {
  export async function isConfigured(recordId: string): Promise<boolean> {
    try {
      return (await fs.stat(getProfilePath(recordId))).isDirectory()
    } catch {
      return false
    }
  }

  export async function status(recordId: string): Promise<BrowserSessionStatus> {
    const profilePath = getProfilePath(recordId)
    const configured = await isConfigured(recordId)
    let meta: { lastRefresh?: number; lastError?: string } = {}
    if (configured) {
      try {
        meta = JSON.parse(await fs.readFile(path.join(profilePath, ".opencode-meta.json"), "utf-8"))
      } catch {}
    }
    return { recordId, enabled: configured, profilePath, lastRefresh: meta.lastRefresh, lastError: meta.lastError, isConfigured: configured }
  }

  export async function listAll(): Promise<BrowserSessionStatus[]> {
    try {
      const entries = await fs.readdir(getBrowsersDir(), { withFileTypes: true })
      return Promise.all(entries.filter((e) => e.isDirectory()).map((e) => status(e.name)))
    } catch {
      return []
    }
  }

  export async function setup(recordId: string, onProgress?: (msg: string) => void): Promise<OAuthTokens> {
    log.info("setting up browser session", { recordId })
    const profilePath = getProfilePath(recordId)
    await ensureDir(profilePath)
    await killExistingBrowser(profilePath)

    const puppeteer = await ensurePuppeteer(onProgress)
    onProgress?.("Opening browser window...")

    let browser: any
    try {
      browser = await launchBrowserWithTimeout(puppeteer, {
        headless: false,
        userDataDir: profilePath,
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-blink-features=AutomationControlled", "--window-size=1280,800"],
      })
    } catch (err) {
      throw new Error(`Failed to launch browser: ${err instanceof Error ? err.message : String(err)}`)
    }

    const page = await browser.newPage()
    await page.setViewport({ width: 1280, height: 800 })

    const pkce = await generatePKCE()
    const authorizeUrl = buildAuthorizeUrl(pkce)
    log.info("navigating to authorize URL", { url: authorizeUrl.toString() })
    await page.goto(authorizeUrl.toString(), { waitUntil: "networkidle0", timeout: 60000 })

    try {
      const startTime = Date.now()
      let code: string | null = null

      while (Date.now() - startTime < 600_000) {
        await new Promise((r) => setTimeout(r, 1000))
        try {
          code = await extractCodeFromCallbackUrl(page)
          if (code) break
        } catch {}
      }

      if (!code) throw new Error("Login timed out. Please try again.")

      const tokens = await exchangeCodeForTokens(code, pkce.verifier)
      await updateMeta(recordId, { lastRefresh: Date.now(), lastError: undefined })
      await closeBrowserSafely(browser, profilePath)
      return tokens
    } catch (error) {
      await closeBrowserSafely(browser, profilePath)
      await updateMeta(recordId, { lastError: error instanceof Error ? error.message : String(error) })
      throw error
    }
  }

  export async function refresh(recordId: string): Promise<OAuthTokens> {
    log.info("refreshing tokens via browser session", { recordId })

    const existing = browserLocks.get(recordId)
    if (existing) {
      try { await existing } catch {}
    }

    let resolveLock!: () => void
    const lock = new Promise<void>((resolve) => { resolveLock = resolve })
    browserLocks.set(recordId, lock)

    try {
      return await doRefresh(recordId)
    } finally {
      resolveLock()
      browserLocks.delete(recordId)
    }
  }

  export async function remove(recordId: string): Promise<void> {
    log.info("removing browser session", { recordId })
    const profilePath = getProfilePath(recordId)
    try {
      await fs.rm(profilePath, { recursive: true, force: true })
    } catch (error) {
      log.error("failed to remove browser session", { recordId, error })
      throw error
    }
  }
}

async function doRefresh(recordId: string): Promise<OAuthTokens> {
  if (!(await AuthBrowser.isConfigured(recordId))) {
    throw new Error(`No browser session configured for record ${recordId}. Run setup first.`)
  }

  const profilePath = getProfilePath(recordId)
  await killExistingBrowser(profilePath)

  const puppeteer = await ensurePuppeteer()
  let browser: any
  try {
    browser = await launchBrowserWithTimeout(puppeteer, {
      headless: true,
      userDataDir: profilePath,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-blink-features=AutomationControlled"],
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(msg.includes("timed out") ? `Browser launch timed out for record ${recordId}.` : msg)
  }

  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 800 })

  const pkce = await generatePKCE()
  const authorizeUrl = buildAuthorizeUrl(pkce)

  try {
    await page.goto(authorizeUrl.toString(), { waitUntil: "networkidle0", timeout: 60000 })

    const startTime = Date.now()
    let code: string | null = null
    let clickedAuthorize = false

    while (Date.now() - startTime < 60_000) {
      await new Promise((r) => setTimeout(r, 500))
      try {
        code = await extractCodeFromCallbackUrl(page)
        if (code) break

        if (!clickedAuthorize && page.url().includes("claude.ai")) {
          const clicked = await page.evaluate(() => {
            // Try to dismiss cookie banner
            const cookieSelectors = ['[data-testid*="cookie"]', '[class*="cookie"]', '[id*="cookie"]', '[class*="consent"]', '[id*="consent"]']
            for (const sel of cookieSelectors) {
              const container = document.querySelector(sel)
              if (container) {
                const btns = Array.from(container.querySelectorAll("button"))
                if (btns.length > 0) { (btns[btns.length - 1] as HTMLElement).click(); return true }
              }
            }

            // Click authorize button: first visible non-deny button with a background
            const denyWords = ["deny", "cancel", "reject", "decline", "no", "nein", "non", "nie"]
            const buttons = Array.from((document.querySelector("main") || document.body).querySelectorAll("button")).filter((btn) => {
              const s = getComputedStyle(btn as Element)
              return s.display !== "none" && s.visibility !== "hidden" && !(btn as HTMLButtonElement).disabled && (btn as HTMLElement).offsetParent !== null
            })
            for (const btn of buttons) {
              const text = btn.textContent?.toLowerCase() ?? ""
              if (denyWords.some((w) => text.includes(w))) continue
              const bg = getComputedStyle(btn as Element).backgroundColor
              if (bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") { (btn as HTMLElement).click(); return true }
            }
            for (const btn of buttons) {
              const text = btn.textContent?.toLowerCase() ?? ""
              if (!denyWords.some((w) => text.includes(w))) { (btn as HTMLElement).click(); return true }
            }
            return false
          })
          if (clicked) {
            log.info("clicked authorize button")
            clickedAuthorize = true
            await new Promise((r) => setTimeout(r, 2000))
          }
        }
      } catch {}
    }

    if (!code) {
      try {
        await page.screenshot({ path: path.join(profilePath, "debug-screenshot.png"), fullPage: true })
      } catch {}
      throw new Error("Session expired or refresh timed out. Please run setup again.")
    }

    const tokens = await exchangeCodeForTokens(code, pkce.verifier)
    await updateMeta(recordId, { lastRefresh: Date.now(), lastError: undefined })
    await closeBrowserSafely(browser, profilePath)
    return tokens
  } catch (error) {
    await closeBrowserSafely(browser, profilePath)
    const message = error instanceof Error ? error.message : String(error)
    await updateMeta(recordId, { lastError: message })
    if (message.toLowerCase().includes("timeout")) {
      throw new Error(`Browser session expired for record ${recordId}. Please run 'opencode auth browser setup' again.`)
    }
    throw error
  }
}
