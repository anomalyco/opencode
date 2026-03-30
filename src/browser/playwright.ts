import { Log } from "@/util/log"
import { Flag } from "@/flag/flag"
import { Global } from "@/global"
import path from "path"
import fs from "fs/promises"

const log = Log.create({ service: "browser.playwright" })

/**
 * Playwright manages the Chrome lifecycle.
 *
 * Flow:
 * 1. Playwright launches Chrome (headed, persistent profile)
 * 2. Exposes CDP port for agent-browser to connect
 * 3. agent-browser uses --cdp to talk to this Chrome (primary)
 * 4. Playwright is also available as fallback for edge cases
 *    (iframe issues, complex interactions agent-browser can't handle)
 */
export namespace PlaywrightLauncher {
  let browser: any | undefined
  let context: any | undefined
  let page: any | undefined
  let cdpPort: number | undefined
  let chromium: any | undefined

  /** Default CDP debugging port */
  const DEFAULT_CDP_PORT = 9222

  /** Persistent profile directory */
  function getProfilePath(): string {
    return path.join(Global.Path.data, "browser-profile")
  }

  /**
   * Launch Chrome via Playwright and return the CDP port.
   * Chrome is launched in headed mode with a persistent profile.
   */
  export async function launch(options?: {
    headed?: boolean
    port?: number
    profile?: string
    viewport?: { width: number; height: number }
  }): Promise<{ cdpPort: number; browser: any; context: any; page: any }> {
    if (browser && cdpPort) {
      log.info("Chrome already running", { cdpPort })
      return { cdpPort, browser, context: context!, page: page! }
    }

    // Lazy import playwright to avoid loading it when not needed
    const pw = await import("playwright")
    chromium = pw.chromium

    const profilePath = options?.profile || getProfilePath()
    await fs.mkdir(profilePath, { recursive: true })

    const port = options?.port || DEFAULT_CDP_PORT
    const headed = options?.headed ?? Flag.ATHENA_BROWSER_HEADED

    log.info("launching Chrome via Playwright", {
      headed,
      port,
      profile: profilePath,
    })

    // Launch persistent context — this keeps cookies/logins across sessions
    // and exposes CDP on the specified port
    context = await chromium.launchPersistentContext(profilePath, {
      headless: !headed,
      args: [
        `--remote-debugging-port=${port}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-infobars",
      ],
      viewport: options?.viewport || { width: 1280, height: 800 },
      ignoreHTTPSErrors: true,
    })

    // Get the browser instance from context
    browser = context.browser?.() || context

    // Get or create the first page
    const pages = context.pages()
    page = pages.length > 0 ? pages[0] : await context.newPage()

    cdpPort = port

    log.info("Chrome launched", { cdpPort: port, headed })

    return { cdpPort: port, browser, context, page }
  }

  /**
   * Get the current CDP port (if Chrome is running).
   */
  export function getCdpPort(): number | undefined {
    return cdpPort
  }

  /**
   * Get the Playwright page object for direct fallback operations.
   */
  export function getPage(): any | undefined {
    return page
  }

  /**
   * Get the Playwright context for direct fallback operations.
   */
  export function getContext(): any | undefined {
    return context
  }

  /**
   * Check if Chrome is running.
   */
  export function isRunning(): boolean {
    return browser !== undefined && cdpPort !== undefined
  }

  /**
   * Close Chrome and cleanup.
   */
  export async function close(): Promise<void> {
    log.info("closing Chrome")
    try {
      if (context) {
        await context.close().catch(() => {})
      }
    } catch (e) {
      log.warn("error closing Chrome", { error: String(e) })
    }
    browser = undefined
    context = undefined
    page = undefined
    cdpPort = undefined
  }

  /**
   * Force kill Chrome — used during process exit as last resort.
   */
  export function forceKill(): void {
    try {
      if (context) {
        context.close().catch(() => {})
      }
    } catch {}
    browser = undefined
    context = undefined
    page = undefined
    cdpPort = undefined
  }

  // --- Playwright Fallback Methods ---
  // Used when agent-browser can't handle something (iframes, etc.)

  /**
   * Fallback: navigate to URL via Playwright directly.
   */
  export async function goto(url: string): Promise<void> {
    if (!page) throw new Error("Chrome not running")
    await page.goto(url, { waitUntil: "domcontentloaded" })
  }

  /**
   * Fallback: click element via Playwright selector.
   */
  export async function click(selector: string): Promise<void> {
    if (!page) throw new Error("Chrome not running")
    await page.click(selector)
  }

  /**
   * Fallback: type into element via Playwright selector.
   */
  export async function fill(selector: string, text: string): Promise<void> {
    if (!page) throw new Error("Chrome not running")
    await page.fill(selector, text)
  }

  /**
   * Fallback: get page content/text.
   */
  export async function content(): Promise<string> {
    if (!page) throw new Error("Chrome not running")
    return page.content()
  }

  /**
   * Fallback: take screenshot via Playwright.
   */
  export async function screenshot(filepath: string): Promise<void> {
    if (!page) throw new Error("Chrome not running")
    await page.screenshot({ path: filepath, fullPage: false })
  }

  /**
   * Fallback: evaluate JavaScript via Playwright.
   */
  export async function evaluate(js: string): Promise<any> {
    if (!page) throw new Error("Chrome not running")
    return page.evaluate(js)
  }

  /**
   * Fallback: handle frames/iframes via Playwright.
   * Returns all frames or a specific frame by name/url.
   */
  export async function frame(nameOrUrl?: string): Promise<any> {
    if (!page) throw new Error("Chrome not running")
    if (!nameOrUrl) return page.mainFrame()
    return page.frame(nameOrUrl) || page.frame({ url: new RegExp(nameOrUrl) })
  }

  /**
   * Fallback: get current URL.
   */
  export function url(): string {
    if (!page) throw new Error("Chrome not running")
    return page.url()
  }

  /**
   * Fallback: wait for selector/navigation.
   */
  export async function waitForSelector(selector: string, options?: { timeout?: number }): Promise<void> {
    if (!page) throw new Error("Chrome not running")
    await page.waitForSelector(selector, options)
  }

  /**
   * Fallback: wait for navigation.
   */
  export async function waitForNavigation(options?: { timeout?: number }): Promise<void> {
    if (!page) throw new Error("Chrome not running")
    await page.waitForNavigation(options)
  }

  /**
   * Fallback: get page title.
   */
  export async function title(): Promise<string> {
    if (!page) throw new Error("Chrome not running")
    return page.title()
  }
}
