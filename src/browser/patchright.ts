import { Log } from "@/util/log"
import { Flag } from "@/flag/flag"
import { Global } from "@/global"
import path from "path"
import fs from "fs/promises"

const log = Log.create({ service: "browser.patchright" })

/**
 * Patchright manages the Chrome lifecycle with stealth patches.
 *
 * Patchright is a drop-in Playwright replacement that bypasses
 * anti-bot detection (Runtime.enable leak, automation flags, etc.).
 *
 * Flow:
 * 1. Patchright launches Chrome (headed, stealth, persistent profile)
 * 2. Exposes CDP port for agent-browser to connect
 * 3. agent-browser uses --cdp to talk to this Chrome (primary tools)
 * 4. Patchright is also available as fallback for edge cases
 *    (iframe issues, shadow DOM, complex interactions)
 */
export namespace PatchrightLauncher {
  let browser: any | undefined
  let context: any | undefined
  let page: any | undefined
  let cdpPort: number | undefined
  let chromium: any | undefined

  const DEFAULT_CDP_PORT = 9222

  function getProfilePath(): string {
    return path.join(Global.Path.data, "browser-profile")
  }

  /**
   * Launch Chrome via Patchright with stealth patches.
   * Uses launchPersistentContext with channel: "chrome" for maximum stealth.
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

    // Lazy import patchright
    const pw = await import("patchright")
    chromium = pw.chromium

    const profilePath = options?.profile || getProfilePath()
    await fs.mkdir(profilePath, { recursive: true })

    const port = options?.port || DEFAULT_CDP_PORT
    const headed = options?.headed ?? Flag.ATHENA_BROWSER_HEADED

    log.info("launching Chrome via Patchright (stealth)", {
      headed,
      port,
      profile: profilePath,
    })

    // Launch persistent context with stealth config
    // channel: "chrome" uses real Google Chrome (not Chromium) for best stealth
    // viewport: null uses real window size (not detectable fixed viewport)
    context = await chromium.launchPersistentContext(profilePath, {
      channel: "chrome",
      headless: !headed,
      viewport: options?.viewport || null,
      args: [
        `--remote-debugging-port=${port}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-infobars",
        "--start-maximized",
      ],
      ignoreHTTPSErrors: true,
      bypassCSP: true,
    })

    browser = context.browser?.() || context

    const pages = context.pages()
    page = pages.length > 0 ? pages[0] : await context.newPage()

    cdpPort = port

    log.info("Chrome launched via Patchright", { cdpPort: port, headed })

    return { cdpPort: port, browser, context, page }
  }

  export function getCdpPort(): number | undefined {
    return cdpPort
  }

  export function getPage(): any | undefined {
    return page
  }

  export function getContext(): any | undefined {
    return context
  }

  export function isRunning(): boolean {
    return browser !== undefined && cdpPort !== undefined
  }

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

  // --- Patchright Fallback Methods ---
  // Used when agent-browser can't handle something

  export async function goto(url: string): Promise<void> {
    if (!page) throw new Error("Chrome not running")
    await page.goto(url, { waitUntil: "domcontentloaded" })
  }

  export async function click(selector: string): Promise<void> {
    if (!page) throw new Error("Chrome not running")
    await page.click(selector)
  }

  export async function fill(selector: string, text: string): Promise<void> {
    if (!page) throw new Error("Chrome not running")
    await page.fill(selector, text)
  }

  export async function content(): Promise<string> {
    if (!page) throw new Error("Chrome not running")
    return page.content()
  }

  export async function screenshot(filepath: string): Promise<void> {
    if (!page) throw new Error("Chrome not running")
    await page.screenshot({ path: filepath, fullPage: false })
  }

  export async function evaluate(js: string): Promise<any> {
    if (!page) throw new Error("Chrome not running")
    return page.evaluate(js)
  }

  export async function frame(nameOrUrl?: string): Promise<any> {
    if (!page) throw new Error("Chrome not running")
    if (!nameOrUrl) return page.mainFrame()
    return page.frame(nameOrUrl) || page.frame({ url: new RegExp(nameOrUrl) })
  }

  export function url(): string {
    if (!page) throw new Error("Chrome not running")
    return page.url()
  }

  export async function waitForSelector(selector: string, options?: { timeout?: number }): Promise<void> {
    if (!page) throw new Error("Chrome not running")
    await page.waitForSelector(selector, options)
  }

  export async function waitForNavigation(options?: { timeout?: number }): Promise<void> {
    if (!page) throw new Error("Chrome not running")
    await page.waitForNavigation(options)
  }

  export async function title(): Promise<string> {
    if (!page) throw new Error("Chrome not running")
    return page.title()
  }
}
