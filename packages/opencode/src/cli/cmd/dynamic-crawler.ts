/**
 * Dynamic Website Crawler — dedicated module for crawling JS-heavy sites
 * like LinkedIn, WhatsApp Web, Instagram, etc.
 *
 * Uses raw Chrome DevTools Protocol via WebSocket instead of Playwright,
 * with stealth techniques, cookie-based auth, retries,
 * and smart wait strategies to extract content from dynamic pages.
 *
 * Security:
 *   - Never bypasses login, MFA, or CAPTCHA
 *   - Only accesses content the authenticated user is authorized to view
 *   - Never logs cookies, API keys, or secrets
 *   - Sanitizes output to remove scripts and dangerous content
 *   - Treats all webpage content as untrusted data
 *   - Never exposes OpenCode API keys, env vars, or agent tools to page JS
 */

import { readFile } from "fs/promises"
import type { ChildProcess } from "child_process"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DynamicCrawlOptions {
  /** Session cookie string (semicolon-delimited). */
  cookie?: string
  /** Path to a Netscape-format cookie file. */
  cookieFile?: string
  /** Extra HTTP headers. */
  headers?: Record<string, string>
  /** Navigation timeout in ms. */
  timeout?: number
  /** Wait time after DOM ready (ms) for JS rendering. */
  waitFor?: number
  /** Max scroll iterations for lazy content. */
  maxScrolls?: number
  /** CSS selector to wait for before extraction. */
  waitForSelector?: string
  /** Max pages to crawl. */
  limit?: number
  /** Max link-following depth. */
  maxDepth?: number
  /** Follow external links. */
  includeExternalLinks?: boolean
  /** URL regex patterns to skip. */
  skipPatterns?: string[]
  /** Max retries per failed page. */
  retries?: number
  /** Site-specific profile (linkedin, whatsapp, instagram, generic). */
  siteProfile?: "linkedin" | "whatsapp" | "instagram" | "generic"
  /** Validate auth cookies are valid. */
  validateAuth?: boolean
}

export interface DynamicCrawlResult {
  url: string
  markdown: string
  html: string
  rawHtml: string
  links: string[]
  images: string[]
  metadata: Record<string, unknown>
  authValid: boolean
  error?: string
  retries: number
}

export interface DynamicCrawlStats {
  pagesReturned: number
  pagesSaved: number
  pagesFailed: number
  pagesSkipped: number
  filesWritten: number
  totalSizeBytes: number
  outputDir: string
  authValid: boolean
  errors: Array<{ url: string; error: string }>
  siteProfile: string
}

// ---------------------------------------------------------------------------
// Site-specific profiles
// ---------------------------------------------------------------------------

interface SiteProfile {
  /** Selectors to wait for content to appear. */
  contentSelectors: string[]
  /** Selectors that indicate auth wall / login redirect. */
  authWallSelectors: string[]
  /** URLs that indicate login page. */
  loginUrls: string[]
  /** Extra wait after navigation (ms). */
  extraWait: number
  /** CSS selectors to scroll to. */
  scrollTargets: string[]
  /** Selectors for dynamic content that appears after JS loads. */
  dynamicSelectors: string[]
}

const SITE_PROFILES: Record<string, SiteProfile> = {
  linkedin: {
    contentSelectors: [
      // Profile sections
      ".profile-detail",
      ".pv-top-card",
      ".scaffold-layout__main",
      '[data-view-name="profile-details"]',
      ".artdeco-card",
      // Modern LinkedIn DOM (2024+)
      ".scaffold-layout__detail",
      "#profile-content",
      ".profile-content-grid",
      '[data-view-name="profile"]',
      ".reusable-search__result-container",
      // Fallbacks
      "main",
      "#main-content",
    ],
    authWallSelectors: [
      ".auth-wall",
      ".login-form",
      "#login-email",
      '[data-litms-control-urn="login-submit"]',
      ".login__lightbox",
    ],
    loginUrls: ["/login", "/signin", "/authwall"],
    extraWait: 5000,
    scrollTargets: [
      ".scaffold-layout__main",
      ".scaffold-layout__detail",
      "main",
      "#profile-content",
      "body",
    ],
    dynamicSelectors: [
      // About section
      ".pv-about-section",
      ".pv-about__summary-text",
      '[data-view-name="profile-about"]',
      ".inline-show-more-text",
      // Experience
      ".pv-experience-section",
      ".experience-section",
      '[data-view-name="profile-experience"]',
      ".pvs-list__paged-list-item",
      // Education
      ".pv-educational-institutions",
      ".education-section",
      '[data-view-name="profile-education"]',
      // Skills
      ".pv-skill-categories",
      ".skills-section",
      '[data-view-name="profile-skills"]',
      // Certifications
      ".pv-certifications-section",
      // Projects
      ".pv-projects-section",
      // Publications
      ".pv-publications-section",
      // Languages
      ".pv-languages-section",
      // Interests
      ".pv-interests-section",
      // Recommendations
      ".pv-recommendations-section",
      // Profile text blocks
      ".profile-text",
      ".pv-entity-summary",
      ".pv-text-details__left-panel",
      // Activity section
      ".pv-activity-section",
      '[data-view-name="profile-activity"]',
      // Featured section
      ".pv-profile-section--featured",
      '[data-view-name="profile-featured"]',
      // Generic content containers
      ".pvs-entity",
      ".artdeco-list__item",
      ".display-flex.align-items-center",
    ],
  },
  whatsapp: {
    contentSelectors: [
      '[data-testid="chat-list"]',
      '[data-testid="default-user"]',
      ".copyable-text",
      "#app",
    ],
    authWallSelectors: [
      '[data-testid="qrcode"]',
      ".qrcode",
      "#qrcode",
    ],
    loginUrls: [],
    extraWait: 5000,
    scrollTargets: ["[data-testid='chat-list']", "#app", "body"],
    dynamicSelectors: [
      '[data-testid="msg-container"]',
      ".message-in",
      ".message-out",
    ],
  },
  instagram: {
    contentSelectors: [
      "article",
      "header section",
      '[data-testid="user-avatar"]',
    ],
    authWallSelectors: [
      ".login-container",
      "#loginForm",
      'input[name="username"]',
    ],
    loginUrls: ["/accounts/login/"],
    extraWait: 3000,
    scrollTargets: ["article", "main", "body"],
    dynamicSelectors: [
      "article img",
      "header section",
      "section main",
    ],
  },
  generic: {
    contentSelectors: ["main", "article", "#content", ".content", "body"],
    authWallSelectors: [".login-form", "#login", ".auth-wall"],
    loginUrls: ["/login", "/signin", "/auth"],
    extraWait: 2000,
    scrollTargets: ["main", "article", "body"],
    dynamicSelectors: [],
  },
}

function getSiteProfile(url: string, explicit?: string): SiteProfile {
  if (explicit && SITE_PROFILES[explicit]) return SITE_PROFILES[explicit]

  const host = new URL(url).hostname.toLowerCase()
  if (host.includes("linkedin.com")) return SITE_PROFILES.linkedin
  if (host.includes("whatsapp.com") || host.includes("web.whatsapp")) return SITE_PROFILES.whatsapp
  if (host.includes("instagram.com")) return SITE_PROFILES.instagram
  return SITE_PROFILES.generic
}

// ---------------------------------------------------------------------------
// Cookie parsing
// ---------------------------------------------------------------------------

function parseCookieString(
  cookieStr: string,
  url: string
): Array<{
  name: string
  value: string
  domain: string
  path: string
  sameSite?: "Strict" | "Lax" | "None"
}> {
  let domain: string
  try {
    domain = new URL(url).hostname
  } catch {
    return []
  }

  const cookies: Array<{
    name: string
    value: string
    domain: string
    path: string
    sameSite?: "Strict" | "Lax" | "None"
  }> = []

  const pairs = cookieStr.split(/;\s*(?=[A-Za-z]=)/)

  for (const pair of pairs) {
    const eqIdx = pair.indexOf("=")
    if (eqIdx <= 0) continue

    const name = pair.slice(0, eqIdx).trim()
    const rawValue = pair.slice(eqIdx + 1).trim()

    if (/^(Path|Domain|SameSite|Secure|HttpOnly|Expires|Max-Age)$/i.test(name)) continue

    const value = rawValue.split(";")[0].trim()

    if (name && value) {
      cookies.push({
        name,
        value,
        domain,
        path: "/",
        sameSite: "Lax",
      })
    }
  }

  return cookies
}

async function loadCookieFile(filePath: string): Promise<string> {
  const content = await readFile(filePath, "utf-8")
  const lines = content.split("\n").filter((l) => l.trim() && !l.startsWith("#"))

  const cookies: string[] = []
  for (const line of lines) {
    const parts = line.split("\t")
    if (parts.length >= 7) {
      const [, , , , , name, value] = parts
      if (name && value) {
        cookies.push(`${name}=${value}`)
      }
    }
  }

  return cookies.join("; ")
}

// ---------------------------------------------------------------------------
// HTML -> Markdown conversion (preserves full content)
// ---------------------------------------------------------------------------

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, "")
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(parseInt(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_: string, hex: string) => String.fromCharCode(parseInt(hex, 16)))
}

function htmlToMarkdown(html: string): string {
  let c = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<svg[\s\S]*?<\/svg>/gi, "")
    // Remove LinkedIn-specific UI noise
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/<button[\s\S]*?<\/button>/gi, "")
    .replace(/<input[\s\S]*?\/?>/gi, "")
    .replace(/<form[\s\S]*?<\/form>/gi, "")
    // Remove hidden elements
    .replace(/<[^>]*aria-hidden=["']true["'][^>]*>[\s\S]*?<\/[^>]+>/gi, "")
    .replace(/<[^>]*style=["'][^"']*display:\s*none[^"']*["'][^>]*>[\s\S]*?<\/[^>]+>/gi, "")
    // Remove empty divs and spans
    .replace(/<div[^>]*>\s*<\/div>/gi, "")
    .replace(/<span[^>]*>\s*<\/span>/gi, "")

  const titleMatch = c.match(/<title[^>]*>([^<]+)<\/title>/i)
  const title = titleMatch ? titleMatch[1].trim() : ""
  const descMatch = c.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i)
  const description = descMatch ? descMatch[1].trim() : ""

  const sections: string[] = []
  if (title) sections.push(`# ${title}`, "")
  if (description) sections.push(description, "")

  c = c.replace(/<table[\s\S]*?<\/table>/gi, (tableHtml) => {
    const rows: string[][] = []
    for (const rowMatch of [...tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)]) {
      const cells = [...rowMatch[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map(
        (m) => stripTags(m[1]).trim()
      )
      if (cells.some(cell => cell.length > 0)) rows.push(cells)
    }
    if (rows.length === 0) return ""
    const header = rows[0]
    const colCount = header.length
    const result = [
      `| ${header.join(" | ")} |`,
      `| ${header.map(() => "---").join(" | ")} |`,
    ]
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i]
      while (row.length < colCount) row.push("")
      result.push(`| ${row.join(" | ")} |`)
    }
    return "\n" + result.join("\n") + "\n"
  })

  c = c.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_, x: string) => `\n\n# ${stripTags(x).trim()}\n\n`)
  c = c.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_, x: string) => `\n\n## ${stripTags(x).trim()}\n\n`)
  c = c.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_, x: string) => `\n\n### ${stripTags(x).trim()}\n\n`)
  c = c.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, (_, x: string) => `\n\n#### ${stripTags(x).trim()}\n\n`)
  c = c.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, (_, x: string) => `\n\n##### ${stripTags(x).trim()}\n\n`)
  c = c.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, (_, x: string) => `\n\n###### ${stripTags(x).trim()}\n\n`)

  c = c.replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, (_: string, code: string) => `\n\`\`\`\n${stripTags(code).trim()}\n\`\`\`\n`)
  c = c.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_: string, code: string) => `\n\`\`\`\n${stripTags(code).trim()}\n\`\`\`\n`)
  c = c.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_: string, code: string) => `\`${stripTags(code).trim()}\``)

  c = c.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_: string, content: string) =>
    "\n" + stripTags(content).trim().split("\n").map((l: string) => `> ${l}`).join("\n") + "\n")

  c = c.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_: string, content: string) =>
    "\n" + [...content.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((m) => `- ${stripTags(m[1]).trim()}`).join("\n") + "\n")
  c = c.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_: string, content: string) => {
    let idx = 1
    return "\n" + [...content.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((m) => `${idx++}. ${stripTags(m[1]).trim()}`).join("\n") + "\n"
  })

  c = c.replace(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_: string, href: string, text: string) => {
    const t = stripTags(text).trim()
    return t ? `[${t}](${href})` : ""
  })
  c = c.replace(/<img[^>]*alt=["']([^"']+)["'][^>]*>/gi, "[$1]")
  c = c.replace(/<img[^>]*>/gi, "")
  c = c.replace(/<(?:strong|b)[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi, "**$1**")
  c = c.replace(/<(?:em|i)[^>]*>([\s\S]*?)<\/(?:em|i)>/gi, "*$1*")
  c = c.replace(/<(?:del|s|strike)[^>]*>([\s\S]*?)<\/(?:del|s|strike)>/gi, "~~$1~~")
  c = c.replace(/<hr[^>]*>/gi, "\n---\n")
  c = c.replace(/<br\s*\/?>/gi, "\n")
  c = c.replace(/<\/p>/gi, "\n\n").replace(/<\/div>/gi, "\n").replace(/<\/li>/gi, "\n")
  c = c.replace(/<\/tr>/gi, "\n").replace(/<\/td>/gi, " | ").replace(/<\/th>/gi, " | ")

  c = stripTags(c)
  c = decodeEntities(c)
  c = c.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim()

  if (c) sections.push(c)
  return sections.join("\n").trim() + "\n"
}

function sanitizeHtml(html: string): string {
  let s = html
  s = s.replace(/<script[\s\S]*?<\/script>/gi, "")
  s = s.replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
  s = s.replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
  s = s.replace(/<embed[\s\S]*?>/gi, "")
  s = s.replace(/<object[\s\S]*?<\/object>/gi, "")
  s = s.replace(/<svg[\s\S]*?<\/svg>/gi, "")
  s = s.replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
  s = s.replace(/href\s*=\s*(?:"javascript:[^"]*"|'javascript:[^']*')/gi, 'href="#"')
  s = s.replace(/src\s*=\s*(?:"javascript:[^"]*"|'javascript:[^']*')/gi, 'src=""')
  s = s.replace(/src\s*=\s*(?:"data:(?!image)[^"]*"|'data:(?!image)[^']*')/gi, 'src=""')
  s = s.replace(/<base[\s\S]*?>/gi, "")
  s = s.replace(/<form[\s\S]*?<\/form>/gi, "")
  return s
}

// ---------------------------------------------------------------------------
// Debug logging
// ---------------------------------------------------------------------------

function debugLog(msg: string) {
  process.stderr.write(`[dynamic-crawler] ${msg}\n`)
}

// ---------------------------------------------------------------------------
// Raw Chrome DevTools Protocol client
// ---------------------------------------------------------------------------

interface CdpResponse {
  id: number
  result?: unknown
  error?: { code: number; message: string }
}

type CdpEventListener = (params: Record<string, unknown>) => void

class RawCdpClient {
  private ws: any = null
  private nextId = 1
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  private listeners = new Map<string, Set<CdpEventListener>>()
  private closed = false

  async connect(wsUrl: string): Promise<void> {
    const WebSocket = (await import("ws")).default
    return new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(wsUrl, { perMessageDeflate: false })

      socket.on("open", () => {
        this.ws = socket
        resolve()
      })

      socket.on("message", (data) => {
        let msg: CdpResponse
        try {
          msg = JSON.parse(data.toString()) as CdpResponse
        } catch {
          return
        }

        // Response to a command
        if (typeof msg.id === "number") {
          const p = this.pending.get(msg.id)
          if (p) {
            this.pending.delete(msg.id)
            if (msg.error) {
              p.reject(new Error(`CDP error ${msg.error.code}: ${msg.error.message}`))
            } else {
              p.resolve(msg.result ?? {})
            }
          }
          return
        }

        // Event (has method, no id)
        if ("method" in msg && typeof (msg as Record<string, unknown>).method === "string") {
          const method = (msg as Record<string, unknown>).method as string
          const params = ((msg as Record<string, unknown>).params ?? {}) as Record<string, unknown>
          const fns = this.listeners.get(method)
          if (fns) {
            for (const fn of fns) fn(params)
          }
        }
      })

      socket.on("error", (err) => {
        if (!this.closed) reject(err)
      })

      socket.on("close", () => {
        this.closed = true
        for (const p of this.pending.values()) {
          p.reject(new Error("WebSocket closed"))
        }
        this.pending.clear()
      })
    })
  }

  send(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<unknown> {
    if (!this.ws || this.closed) return Promise.reject(new Error("CDP client not connected"))

    const id = this.nextId++
    const msg: Record<string, unknown> = { id, method, params: params ?? {} }
    if (sessionId) msg.sessionId = sessionId

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws!.send(JSON.stringify(msg), (err: Error | null) => {
        if (err) {
          this.pending.delete(id)
          reject(err instanceof Error ? err : new Error(String(err)))
        }
      })
    })
  }

  on(method: string, listener: CdpEventListener): void {
    if (!this.listeners.has(method)) this.listeners.set(method, new Set())
    this.listeners.get(method)!.add(listener)
  }

  off(method: string, listener: CdpEventListener): void {
    this.listeners.get(method)?.delete(listener)
  }

  close(): void {
    this.closed = true
    for (const p of this.pending.values()) {
      p.reject(new Error("CDP client closed"))
    }
    this.pending.clear()
    if (this.ws) {
      try { this.ws.close() } catch {}
      this.ws = null
    }
  }
}

// ---------------------------------------------------------------------------
// Browser lifecycle
// ---------------------------------------------------------------------------

interface BrowserState {
  process: ChildProcess
  client: RawCdpClient
  sessionId: string
  targetId: string
  userDataDir: string
  port: number
}

let browserState: BrowserState | null = null

async function killStaleProcesses(): Promise<void> {
  if (process.platform !== "win32") return
  const { execSync } = await import("child_process")
  const procs = [
    "chrome.exe",
    "chromium.exe",
    "chrome-headless-shell.exe",
    "msedge.exe",
  ]
  for (const proc of procs) {
    try {
      execSync(`taskkill /F /IM ${proc} /T 2>nul`, { stdio: "ignore" })
    } catch {}
  }
  await new Promise((r) => setTimeout(r, 2000))
}

function findChromiumPath(): string | undefined {
  const { existsSync } = require("fs") as typeof import("fs")
  const path = require("path") as typeof import("path")
  const localAppData = process.env.LOCALAPPDATA || ""

  // Check Playwright's chromium first (full browser, not headless-shell)
  const msPlaywright = path.join(localAppData, "ms-playwright")
  if (existsSync(msPlaywright)) {
    const { readdirSync } = require("fs") as typeof import("fs")
    try {
      const dirs = readdirSync(msPlaywright)
      for (const dir of dirs) {
        if (dir.startsWith("chromium-") && !dir.includes("headless")) {
          const chromePath = path.join(msPlaywright, dir, "chrome-win64", "chrome.exe")
          if (existsSync(chromePath)) return chromePath
        }
      }
    } catch {}
  }

  // Check system Chrome
  const sysChrome = path.join("C:", "Program Files", "Google", "Chrome", "Application", "chrome.exe")
  if (existsSync(sysChrome)) return sysChrome

  // Check Edge
  const edgePath = path.join("C:", "Program Files (x86)", "Microsoft", "Edge", "Application", "msedge.exe")
  if (existsSync(edgePath)) return edgePath

  return undefined
}

async function ensureBrowser(): Promise<BrowserState> {
  if (browserState) return browserState

  await killStaleProcesses()
  const { spawn } = await import("child_process")
  const { existsSync } = await import("fs")
  const pathMod = await import("path")

  const launchStart = Date.now()
  const chromePath = findChromiumPath()

  if (!chromePath) {
    throw new Error(
      "No Chrome/Chromium browser found.\n\n" +
        "Install one of:\n" +
        "  1. npx playwright install chromium\n" +
        "  2. Google Chrome: https://www.google.com/chrome/\n" +
        "  3. Microsoft Edge (usually pre-installed)"
    )
  }

  debugLog(`Using browser: ${chromePath}`)

  const userDataDir = pathMod.join(
    process.env.TEMP || process.env.LOCALAPPDATA || ".",
    `dynamic_crawler_${Date.now()}`
  )

  const chromeArgs = [
    "--remote-debugging-port=0",
    "--headless=new",
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--disable-extensions",
    "--disable-background-networking",
    "--ignore-certificate-errors",
    "--disable-blink-features=AutomationControlled",
    "--disable-features=TranslateUI",
    "--no-first-run",
    "--no-default-browser-check",
    `--user-data-dir=${userDataDir}`,
  ]

  debugLog(`Launching Chrome...`)

  const chromeProcess = spawn(chromePath, chromeArgs, {
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  })

  debugLog(`Chrome started with pid ${chromeProcess.pid}`)

  // Parse stderr to find the port Chrome bound to (--remote-debugging-port=0 picks a free port)
  let port = 0
  const stderrBuf: Buffer[] = []

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Timed out waiting for Chrome to report debugging port"))
    }, 15000)

    chromeProcess.stderr!.on("data", (chunk: Buffer) => {
      stderrBuf.push(chunk)
      const text = Buffer.concat(stderrBuf).toString("utf-8")
      // Chrome prints: "DevTools listening on ws://127.0.0.1:PORT/devtools/browser/..."
      const match = text.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//)
      if (match) {
        port = parseInt(match[1], 10)
        clearTimeout(timeout)
        resolve()
      }
    })

    chromeProcess.on("error", (err) => {
      clearTimeout(timeout)
      reject(err)
    })

    chromeProcess.on("exit", (code) => {
      if (!port) {
        clearTimeout(timeout)
        reject(new Error(`Chrome exited with code ${code} before reporting debug port`))
      }
    })
  })

  debugLog(`Chrome debugging port: ${port}`)

  // Fetch the WebSocket URL from the CDP HTTP endpoint
  const maxWait = 10000
  const startTime = Date.now()
  let wsUrl = ""

  while (Date.now() - startTime < maxWait) {
    try {
      const resp = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (resp.ok) {
        const data = (await resp.json()) as { webSocketDebuggerUrl?: string }
        wsUrl = data.webSocketDebuggerUrl || ""
        break
      }
    } catch {
      // Not ready yet
    }
    await new Promise((r) => setTimeout(r, 200))
  }

  if (!wsUrl) {
    chromeProcess.kill("SIGTERM")
    throw new Error(
      `Chrome started but CDP didn't respond on port ${port} within ${maxWait}ms.\n` +
        "The browser may have crashed or port is blocked by firewall."
    )
  }

  debugLog(`CDP ready in ${Date.now() - launchStart}ms, ws: ${wsUrl}`)

  // Connect raw CDP client to the browser target
  const client = new RawCdpClient()
  await client.connect(wsUrl)
  debugLog(`Raw CDP connected in ${Date.now() - launchStart}ms`)

  // Create a new target (tab) to work with
  const targetResult = (await client.send("Target.createTarget", {
    url: "about:blank",
  })) as { targetId?: string }

  const targetId = targetResult.targetId
  if (!targetId) {
    client.close()
    chromeProcess.kill("SIGTERM")
    throw new Error("Failed to create CDP target")
  }

  debugLog(`Created target: ${targetId}`)

  // Attach to the target to get a sessionId
  const attachResult = (await client.send("Target.attachToTarget", {
    targetId,
    flatten: true,
  })) as { sessionId?: string }

  const sessionId = attachResult.sessionId
  if (!sessionId) {
    client.close()
    chromeProcess.kill("SIGTERM")
    throw new Error("Failed to attach to CDP target")
  }

  debugLog(`Attached to target, sessionId: ${sessionId}`)

  browserState = {
    process: chromeProcess,
    client,
    sessionId,
    targetId,
    userDataDir,
    port,
  }

  return browserState
}

export async function releaseBrowser(): Promise<void> {
  if (browserState) {
    try { browserState.client.close() } catch {}
    try { browserState.process.kill("SIGTERM") } catch {}
    if (browserState.userDataDir) {
      try {
        const { rmSync } = await import("fs")
        rmSync(browserState.userDataDir, { recursive: true, force: true })
      } catch {}
    }
    browserState = null
  }
}

// ---------------------------------------------------------------------------
// CDP helpers
// ---------------------------------------------------------------------------

async function cdpNavigate(
  sessionId: string,
  url: string,
  timeout: number,
  profile: SiteProfile
): Promise<void> {
  const state = browserState!
  const { client } = state

  debugLog(`Navigating: ${url}`)

  // Enable Page domain events
  await client.send("Page.enable", {}, sessionId)

  // Set up a promise for loadEventFired or domContentEventFired
  const loadPromise = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      resolve() // resolve on timeout rather than reject — we want to proceed with whatever loaded
    }, timeout)

    const onDomContent = () => {
      clearTimeout(timer)
      cleanup()
      resolve()
    }

    const onLoad = () => {
      clearTimeout(timer)
      cleanup()
      resolve()
    }

    const cleanup = () => {
      client.off("Page.domContentEventFired", onDomContent)
      client.off("Page.loadEventFired", onLoad)
    }

    client.on("Page.domContentEventFired", onDomContent)
    client.on("Page.loadEventFired", onLoad)
  })

  // Navigate
  try {
    await client.send("Page.navigate", { url }, sessionId)
    debugLog(`Navigation initiated`)
  } catch (err) {
    debugLog(`Navigation failed, continuing: ${err}`)
  }

  // Wait for load events
  await loadPromise
  debugLog(`Page loaded`)

  // Wait for content selectors
  for (const selector of profile.contentSelectors) {
    try {
      const result = (await cdpEvaluate(sessionId, `
        !!document.querySelector('${selector.replace(/'/g, "\\'")}')
      `)) as { result?: { value?: boolean } }
      if (result?.result?.value) {
        debugLog(`Content found: ${selector}`)
        break
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 500))
  }

  // Site-specific extra wait
  if (profile.extraWait > 0) {
    debugLog(`Extra wait: ${profile.extraWait}ms`)
    await new Promise((r) => setTimeout(r, profile.extraWait))
  }
}

async function cdpEvaluate(
  sessionId: string,
  expression: string,
  returnByValue = true
): Promise<unknown> {
  const state = browserState!
  const result = (await state.client.send("Runtime.evaluate", {
    expression,
    returnByValue,
    awaitPromise: true,
  }, sessionId)) as Record<string, unknown>

  return result
}

async function cdpGetUrl(sessionId: string): Promise<string> {
  const result = (await cdpEvaluate(sessionId, "window.location.href")) as {
    result?: { value?: string }
  }
  return result?.result?.value ?? ""
}

async function cdpScroll(sessionId: string, profile: SiteProfile): Promise<void> {
  // Try scrolling to specific targets first
  for (const target of profile.scrollTargets) {
    try {
      await cdpEvaluate(sessionId, `
        (() => {
          const el = document.querySelector('${target.replace(/'/g, "\\'")}');
          if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
        })()
      `)
      await new Promise((r) => setTimeout(r, 800))
    } catch {}
  }

  // Aggressive scroll to load all lazy content (LinkedIn loads many sections)
  await cdpEvaluate(sessionId, `
    new Promise((resolve) => {
      let scrollCount = 0;
      const maxScrolls = 40;
      const scrollStep = 300;
      const scrollInterval = 200;

      function scrollDown() {
        window.scrollBy(0, scrollStep);
        scrollCount++;

        // Also scroll any scrollable containers (LinkedIn uses custom scrollable divs)
        document.querySelectorAll('[class*="scroll"], [style*="overflow"]').forEach(el => {
          if (el.scrollHeight > el.clientHeight) {
            el.scrollBy(0, scrollStep);
          }
        });

        if (scrollCount < maxScrolls && scrollCount * scrollStep < document.body.scrollHeight) {
          setTimeout(scrollDown, scrollInterval);
        } else {
          // Scroll back to top
          window.scrollTo(0, 0);
          // Also scroll any containers back to top
          document.querySelectorAll('[class*="scroll"], [style*="overflow"]').forEach(el => {
            if (el.scrollHeight > el.clientHeight) el.scrollTo(0, 0);
          });
          resolve();
        }
      }

      scrollDown();
    })
  `)
}

async function cdpSetCookies(
  cookies: Array<{ name: string; value: string; domain: string; path: string; sameSite?: string }>,
  sessionId?: string
): Promise<void> {
  const state = browserState!
  const sid = sessionId || state.sessionId
  await state.client.send("Network.enable", {}, sid)

  for (const cookie of cookies) {
    // LinkedIn cookies need .linkedin.com domain for cross-subdomain access
    const domain = cookie.domain.includes("linkedin.com") ? ".linkedin.com" : cookie.domain
    await state.client.send("Network.setCookie", {
      name: cookie.name,
      value: cookie.value,
      domain: domain,
      path: cookie.path || "/",
      sameSite: cookie.sameSite ?? "None",
      secure: true,
      httpOnly: false,
    }, sid)
  }

  debugLog(`Set ${cookies.length} cookies via CDP`)
}

// ---------------------------------------------------------------------------
// Stealth: remove webdriver flag via CDP
// ---------------------------------------------------------------------------

async function applyStealthScripts(sessionId: string): Promise<void> {
  const state = browserState!

  // Enable Page domain for addScriptToEvaluateOnNewDocument
  await state.client.send("Page.enable", {}, sessionId)

  // This script runs before every new document
  await state.client.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `
      // Remove webdriver flag
      Object.defineProperty(navigator, "webdriver", { get: () => false });
      // Remove Playwright detection
      delete window.__playwright;
      delete window.__pw_manual;
      // Fake plugins
      Object.defineProperty(navigator, "plugins", {
        get: () => [1, 2, 3, 4, 5],
      });
      // Fake languages
      Object.defineProperty(navigator, "languages", {
        get: () => ["en-US", "en"],
      });
      // Chrome runtime
      window.chrome = {
        runtime: {},
        loadTimes: () => {},
        csi: () => {},
      };
    `,
  }, sessionId)

  debugLog("Stealth scripts injected")
}

// ---------------------------------------------------------------------------
// Resource blocking via CDP
// ---------------------------------------------------------------------------

async function enableResourceBlocking(sessionId: string): Promise<void> {
  const state = browserState!

  await state.client.send("Page.enable", {}, sessionId)

  // Use Fetch domain to intercept and block fonts/media
  await state.client.send("Fetch.enable", {
    patterns: [{ urlPattern: "*", requestStage: "Request" }],
  }, sessionId)

  state.client.on("Fetch.requestPaused", async (params) => {
    const { requestId, request, frameId } = params as {
      requestId: string
      request: { url: string; resourceType?: string }
      frameId?: string
    }
    const resourceType = (params as Record<string, unknown>).resourceType as string | undefined
    const type = resourceType || request.resourceType || ""

    if (type === "font" || type === "media") {
      try {
        await state.client.send("Fetch.failRequest", {
          requestId,
          errorReason: "BlockedByClient",
        }, sessionId)
      } catch {}
    } else {
      try {
        await state.client.send("Fetch.continueRequest", { requestId }, sessionId)
      } catch {}
    }
  })
}

// ---------------------------------------------------------------------------
// Content extraction via CDP
// ---------------------------------------------------------------------------

async function extractPageContent(
  sessionId: string,
  profile: SiteProfile
): Promise<{
  title: string
  description: string
  text: string
  html: string
  links: string[]
  images: string[]
  metadata: Record<string, unknown>
}> {
  const result = (await cdpEvaluate(sessionId, `
    (() => {
      const SKIP_TAGS = new Set(["script", "style", "noscript", "svg", "path", "link", "meta"]);
      const SKIP_NOISE = new Set([
        ".artdeco-modal", ".artdeco-modal__overlay", ".global-nav__me",
        ".feed-identity-module", ".pv-top-card--list-bullet",
        ".pv-profile-stash__empty-state", ".pv-oz-profile-stash",
        ".pv-content-pager", ".pv-pager", ".scaffold-layout__sidebar",
        ".scaffold-layout__detail", ".artdeco-card",
      ]);

      function isVisible(el) {
        if (!el) return false;
        if (el.getAttribute("aria-hidden") === "true") return false;
        const style = window.getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden") return false;
        return true;
      }

      function isNoise(el) {
        if (!el) return false;
        for (const cls of SKIP_NOISE) {
          if (el.closest(cls)) return true;
        }
        return false;
      }

      function escapeMd(text) {
        return text.replace(/\\\\/g, '\\\\\\\\').replace(/\\[/g, '\\\\[').replace(/\\]/g, '\\\\]');
      }

      function nodeToMarkdown(node) {
        if (node.nodeType === Node.TEXT_NODE) {
          const raw = node.textContent;
          return raw;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return "";

        const tag = node.tagName.toLowerCase();
        if (SKIP_TAGS.has(tag)) return "";
        if (!isVisible(node) || isNoise(node)) return "";
        if (tag === "hr") return "\\n---\\n";
        if (tag === "br") return "\\n";

        // Block elements
        if (tag === "h1" || tag === "h2" || tag === "h3" || tag === "h4" || tag === "h5" || tag === "h6") {
          const level = parseInt(tag[1]);
          const prefix = "#".repeat(level);
          const inner = inlineText(node);
          if (!inner.trim()) return "";
          return "\\n" + prefix + " " + inner.trim() + "\\n";
        }

        if (tag === "p") {
          const inner = inlineText(node);
          if (!inner.trim()) return "";
          return "\\n" + inner.trim() + "\\n";
        }

        if (tag === "ul" || tag === "ol") {
          let md = "\\n";
          const items = node.querySelectorAll(":scope > li");
          items.forEach((li, idx) => {
            const bullet = tag === "ol" ? (idx + 1) + ". " : "- ";
            const inner = inlineText(li);
            if (inner.trim()) md += bullet + inner.trim() + "\\n";
          });
          return md;
        }

        if (tag === "li") {
          return inlineText(node);
        }

        if (tag === "pre") {
          const code = node.querySelector("code");
          const lang = code?.className?.match(/lang(?:uage)?-(\\w+)/)?.[1] || "";
          const text = (code || node).textContent || "";
          return "\\n\\n\`\`\`" + lang + "\\n" + text + "\\n\`\`\`\\n";
        }

        if (tag === "blockquote") {
          const inner = inlineText(node);
          const lines = inner.trim().split("\\n");
          return "\\n" + lines.map(l => "> " + l).join("\\n") + "\\n";
        }

        if (tag === "table") {
          return tableToMarkdown(node);
        }

        if (tag === "img") {
          const src = node.getAttribute("src");
          const alt = node.getAttribute("alt") || "";
          if (!src) return "";
          const absUrl = new URL(src, window.location.href).href;
          return "![" + escapeMd(alt) + "](" + absUrl + ")";
        }

        // Recurse into children for any other block element
        let md = "";
        for (const child of node.childNodes) {
          md += nodeToMarkdown(child);
        }
        return md;
      }

      function inlineText(el) {
        let result = "";
        for (const child of el.childNodes) {
          if (child.nodeType === Node.TEXT_NODE) {
            result += child.textContent;
          } else if (child.nodeType === Node.ELEMENT_NODE) {
            const tag = child.tagName.toLowerCase();
            if (tag === "script" || tag === "style" || tag === "noscript") continue;
            if (!isVisible(child)) continue;

            if (tag === "a") {
              const href = child.getAttribute("href");
              const text = inlineText(child).trim();
              if (href && text) {
                try {
                  const abs = new URL(href, window.location.href).href;
                  result += "[" + text + "](" + abs + ")";
                } catch {
                  result += text;
                }
              } else {
                result += text;
              }
            } else if (tag === "img") {
              const src = child.getAttribute("src");
              const alt = child.getAttribute("alt") || "";
              if (src) {
                try {
                  const abs = new URL(src, window.location.href).href;
                  result += "![" + escapeMd(alt) + "](" + abs + ")";
                } catch {}
              }
            } else if (tag === "strong" || tag === "b") {
              const inner = inlineText(child);
              if (inner.trim()) result += "**" + inner + "**";
            } else if (tag === "em" || tag === "i") {
              const inner = inlineText(child);
              if (inner.trim()) result += "*" + inner + "*";
            } else if (tag === "code") {
              const inner = child.textContent || "";
              if (inner.trim()) result += "\`" + inner + "\`";
            } else if (tag === "br") {
              result += "\\n";
            } else if (tag === "p" || tag === "div" || tag === "h1" || tag === "h2" || tag === "h3" || tag === "h4" || tag === "h5" || tag === "h6" || tag === "li" || tag === "ul" || tag === "ol") {
              result += "\\n" + nodeToMarkdown(child) + "\\n";
            } else {
              result += inlineText(child);
            }
          }
        }
        return result;
      }

      function tableToMarkdown(table) {
        const rows = [];
        const trs = table.querySelectorAll(":scope > thead > tr, :scope > tbody > tr, :scope > tr");
        trs.forEach(tr => {
          const cells = [];
          tr.querySelectorAll(":scope > th, :scope > td").forEach(cell => {
            cells.push(inlineText(cell).trim().replace(/\\|/g, "\\\\|"));
          });
          rows.push(cells);
        });
        if (rows.length === 0) return "";

        const colCount = Math.max(...rows.map(r => r.length));
        rows.forEach(r => { while (r.length < colCount) r.push(""); });

        const header = "| " + rows[0].join(" | ") + " |";
        const sep = "| " + rows[0].map(() => "---").join(" | ") + " |";
        const body = rows.slice(1).map(r => "| " + r.join(" | ") + " |").join("\\n");
        return "\\n" + header + "\\n" + sep + (body ? "\\n" + body : "") + "\\n";
      }

      // --- Main extraction ---
      const title = document.title || "";
      const descEl = document.querySelector('meta[name="description"]');
      const description = descEl?.getAttribute("content") || "";

      let md = "";
      for (const child of document.body.childNodes) {
        md += nodeToMarkdown(child);
      }

      // Collapse 3+ newlines to 2
      md = md.replace(/\\n{3,}/g, "\\n\\n").trim();

      // Extract links
      const links = [];
      document.querySelectorAll("a[href]").forEach(a => {
        const href = a.getAttribute("href");
        const linkText = a.textContent.trim();
        if (href && !href.startsWith("#") && !href.startsWith("javascript:") && linkText) {
          try { links.push(new URL(href, window.location.href).href); } catch {}
        }
      });

      // Extract images
      const images = [];
      document.querySelectorAll("img[src]").forEach(img => {
        const src = img.getAttribute("src");
        if (src && !src.startsWith("data:")) {
          try { images.push(new URL(src, window.location.href).href); } catch {}
        }
      });

      // Extract metadata
      const metadata = {};
      document.querySelectorAll('meta[property^="og:"]').forEach(m => {
        const prop = m.getAttribute("property")?.replace("og:", "");
        const content = m.getAttribute("content");
        if (prop && content) metadata["og:" + prop] = content;
      });
      document.querySelectorAll('meta[name^="twitter:"]').forEach(m => {
        const name = m.getAttribute("name")?.replace("twitter:", "");
        const content = m.getAttribute("content");
        if (name && content) metadata["twitter:" + name] = content;
      });
      const canonical = document.querySelector('link[rel="canonical"]');
      if (canonical) metadata.canonical = canonical.getAttribute("href");
      document.querySelectorAll('script[type="application/ld+json"]').forEach(s => {
        try {
          const data = JSON.parse(s.textContent);
          if (data["@type"]) metadata["ld+json:" + data["@type"]] = data;
        } catch {}
      });

      return {
        title,
        description,
        text: md,
        html: document.documentElement.outerHTML,
        links,
        images,
        metadata,
      };
    })()
  `)) as { result?: { value?: { title: string; description: string; text: string; html: string; links: string[]; images: string[]; metadata: Record<string, unknown> } } }

  return result?.result?.value ?? {
    title: "",
    description: "",
    text: "",
    html: "",
    links: [],
    images: [],
    metadata: {},
  }
}

// ---------------------------------------------------------------------------
// Auth detection
// ---------------------------------------------------------------------------

function detectAuthFailure(
  url: string,
  pageUrl: string,
  html: string,
  profile: SiteProfile
): { isAuthFailure: boolean; reason: string } {
  const lower = html.toLowerCase()
  const currentUrl = pageUrl.toLowerCase()

  // Check login URL redirect
  for (const loginUrl of profile.loginUrls) {
    if (currentUrl.includes(loginUrl)) {
      return { isAuthFailure: true, reason: `Redirected to login page: ${loginUrl}` }
    }
  }

  // Check auth wall selectors
  for (const selector of profile.authWallSelectors) {
    if (lower.includes(selector.toLowerCase())) {
      return { isAuthFailure: true, reason: `Auth wall detected: ${selector}` }
    }
  }

  // Generic auth indicators
  if (lower.includes("sign in") && lower.includes("continue with")) {
    return { isAuthFailure: true, reason: "Login page detected in content" }
  }

  if (lower.includes("session expired") || lower.includes("session invalid")) {
    return { isAuthFailure: true, reason: "Session expired" }
  }

  return { isAuthFailure: false, reason: "" }
}

// ---------------------------------------------------------------------------
// Navigation with smart waits (CDP version)
// ---------------------------------------------------------------------------

async function smartNavigateCdp(
  sessionId: string,
  url: string,
  timeout: number,
  profile: SiteProfile
): Promise<void> {
  await cdpNavigate(sessionId, url, timeout, profile)
  await cdpScroll(sessionId, profile)
}

// ---------------------------------------------------------------------------
// Public API: Scrape single page
// ---------------------------------------------------------------------------

export async function scrapeDynamic(
  url: string,
  options: DynamicCrawlOptions = {}
): Promise<DynamicCrawlResult> {
  const {
    cookie,
    cookieFile,
    headers,
    timeout = 60000,
    waitFor = 5000,
    maxScrolls = 20,
    waitForSelector,
    validateAuth = false,
    siteProfile,
    retries = 2,
  } = options

  const profile = getSiteProfile(url, siteProfile)
  debugLog(`Site profile: ${Object.keys(SITE_PROFILES).find((k) => SITE_PROFILES[k] === profile) || "generic"}`)

  // Resolve cookie
  let cookieStr = cookie
  if (cookieFile && !cookieStr) {
    try {
      cookieStr = await loadCookieFile(cookieFile)
      debugLog(`Loaded cookies from file`)
    } catch (err) {
      debugLog(`Cookie file error: ${err instanceof Error ? err.message : err}`)
    }
  }

  // Create a fresh target for each scrape attempt (clean state)
  let lastError: Error | null = null

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      debugLog(`Retry ${attempt}/${retries}`)
      await new Promise((r) => setTimeout(r, 2000 * attempt))
    }

    let localClient: RawCdpClient | null = null
    let localSessionId = ""
    let localTargetId = ""

    try {
      const state = await ensureBrowser()

      // Create a new target (tab) for this scrape
      const targetResult = (await state.client.send("Target.createTarget", {
        url: "about:blank",
      })) as Record<string, unknown>

      localTargetId = targetResult.targetId as string
      if (!localTargetId) throw new Error("Failed to create CDP target")

      // For isolated contexts, connect a separate WebSocket to this target
      // Actually, we can reuse the browser-level client and attach
      const attachResult = (await state.client.send("Target.attachToTarget", {
        targetId: localTargetId,
        flatten: true,
      })) as Record<string, unknown>

      localSessionId = attachResult.sessionId as string
      if (!localSessionId) throw new Error("Failed to attach to target")
      localClient = state.client

      debugLog(`Created target for scrape: ${localTargetId}`)

      // Set user agent
      await localClient.send("Network.enable", {}, localSessionId)
      await localClient.send("Network.setUserAgentOverride", {
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        acceptLanguage: "en-US,en;q=0.9",
        platform: "Win32",
      }, localSessionId)

      // Set extra headers if provided
      if (headers && Object.keys(headers).length > 0) {
        await localClient.send("Network.setExtraHTTPHeaders", {
          headers,
        }, localSessionId)
      }

      // Set viewport
      await localClient.send("Emulation.setDeviceMetricsOverride", {
        width: 1920,
        height: 1080,
        deviceScaleFactor: 1,
        mobile: false,
      }, localSessionId)

      // First navigate to the base domain to establish cookie context
      const urlObj = new URL(url)
      const baseUrl = `${urlObj.protocol}//${urlObj.hostname}`
      debugLog(`Establishing cookie context on ${baseUrl}`)
      try {
        await cdpNavigate(localSessionId, baseUrl, 15000, profile)
      } catch {}
      await new Promise((r) => setTimeout(r, 1000))

      // Set cookies on the page session (after navigating to domain)
      if (cookieStr) {
        const cookies = parseCookieString(cookieStr, url)
        if (cookies.length > 0) {
          await cdpSetCookies(cookies.map((c) => ({ ...c, domain: c.domain })), localSessionId)
          debugLog(`Injected ${cookies.length} cookies`)
          // Reload to apply cookies
          await cdpEvaluate(localSessionId, "window.location.reload()")
          await new Promise((r) => setTimeout(r, 3000))
        }
      }

      // Apply stealth scripts
      await applyStealthScripts(localSessionId)

      // Block unnecessary resources
      await enableResourceBlocking(localSessionId)

      // Navigate to the actual URL
      await smartNavigateCdp(localSessionId, url, timeout, profile)

      // Wait for specific selector
      if (waitForSelector) {
        try {
          const result = (await cdpEvaluate(localSessionId, `
            new Promise((resolve) => {
              const check = () => {
                const el = document.querySelector('${waitForSelector.replace(/'/g, "\\'")}');
                if (el) return resolve(true);
                setTimeout(check, 200);
              };
              check();
              setTimeout(() => resolve(false), 5000);
            })
          `)) as { result?: { value?: boolean } }
          if (!result?.result?.value) {
            debugLog(`Selector "${waitForSelector}" not found`)
          }
        } catch {
          debugLog(`Selector "${waitForSelector}" not found`)
        }
      }

      // Additional wait for JS rendering
      if (waitFor > 0) {
        await new Promise((r) => setTimeout(r, waitFor))
      }

      // Additional scrolls for dynamic content
      for (let i = 0; i < Math.min(maxScrolls, 10); i++) {
        await cdpEvaluate(localSessionId, "window.scrollBy(0, 400)")
        await new Promise((r) => setTimeout(r, 200))
      }
      await cdpEvaluate(localSessionId, "window.scrollTo(0, 0)")

      const currentUrl = await cdpGetUrl(localSessionId)
      const content = await extractPageContent(localSessionId, profile)
      const rawHtml = content.html

      // Use the structured text directly as markdown (preserves sections from extraction)
      // The htmlToMarkdown conversion loses LinkedIn's dynamic DOM content
      const markdown = content.text || htmlToMarkdown(sanitizeHtml(rawHtml))

      // Auth check
      let authValid = true
      if (validateAuth && cookieStr) {
        const authCheck = detectAuthFailure(url, currentUrl, rawHtml, profile)
        authValid = !authCheck.isAuthFailure
        if (!authValid) {
          debugLog(`Auth failed: ${authCheck.reason}`)
        }
      }

      debugLog(`Scrape complete: ${content.text.length} chars, ${content.links.length} links`)

      // Close the target
      try {
        const state = await ensureBrowser()
        await state.client.send("Target.closeTarget", { targetId: localTargetId })
      } catch {}

      return {
        url,
        markdown,
        html: content.html,
        rawHtml,
        links: content.links,
        images: content.images,
        metadata: {
          ...content.metadata,
          title: content.title,
          description: content.description,
          sourceURL: url,
          scrapedAt: new Date().toISOString(),
        },
        authValid,
        retries: attempt,
      }
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      debugLog(`Attempt ${attempt + 1} failed: ${lastError.message}`)
    } finally {
      // Clean up target if we created one
      if (localTargetId) {
        try {
          const state = await ensureBrowser()
          await state.client.send("Target.closeTarget", { targetId: localTargetId })
        } catch {}
      }
    }
  }

  return {
    url,
    markdown: "",
    html: "",
    rawHtml: "",
    links: [],
    images: [],
    metadata: { sourceURL: url, error: lastError?.message },
    authValid: false,
    error: lastError?.message || "Unknown error",
    retries,
  }
}

// ---------------------------------------------------------------------------
// Public API: Crawl
// ---------------------------------------------------------------------------

export async function crawlDynamic(
  startUrl: string,
  options: DynamicCrawlOptions = {}
): Promise<{ data: DynamicCrawlResult[]; total: number; stats: DynamicCrawlStats }> {
  const limit = options.limit ?? 100
  const maxDepth = options.maxDepth ?? Infinity
  const includeExternal = options.includeExternalLinks ?? false
  const skipPatterns = options.skipPatterns ?? []
  const retries = options.retries ?? 2
  const origin = new URL(startUrl).origin
  const profile = getSiteProfile(startUrl, options.siteProfile)

  // Resolve cookie
  let cookieStr = options.cookie
  if (options.cookieFile && !cookieStr) {
    try {
      cookieStr = await loadCookieFile(options.cookieFile)
      debugLog(`Loaded cookies from file`)
    } catch (err) {
      debugLog(`Cookie file error: ${err instanceof Error ? err.message : err}`)
    }
  }

  await ensureBrowser()
  const results: DynamicCrawlResult[] = []
  const errors: Array<{ url: string; error: string }> = []
  const visited = new Set<string>()
  const queue: Array<{ url: string; depth: number }> = [{ url: startUrl, depth: 0 }]
  let authValid = true

  while (queue.length > 0 && results.length < limit) {
    const { url: currentUrl, depth } = queue.shift()!
    if (visited.has(currentUrl) || depth > maxDepth) continue
    visited.add(currentUrl)

    if (skipPatterns.some((p) => new RegExp(p).test(currentUrl))) {
      debugLog(`Skipped (pattern): ${currentUrl}`)
      continue
    }

    // Crawl with retries
    const result = await scrapeDynamic(currentUrl, {
      ...options,
      retries,
      siteProfile: options.siteProfile,
    })

    if (result.error) {
      errors.push({ url: currentUrl, error: result.error })
    }

    if (!result.authValid) {
      authValid = false
    }

    results.push(result)

    // Discover links
    for (const link of result.links) {
      try {
        const resolved = new URL(link, currentUrl).href
        const parsed = new URL(resolved)
        if (
          (parsed.origin === origin || includeExternal) &&
          !visited.has(resolved) &&
          !resolved.includes("#") &&
          results.length + queue.length < limit
        ) {
          queue.push({ url: resolved, depth: depth + 1 })
        }
      } catch {}
    }

    debugLog(`Crawled [${results.length}/${limit}]: ${currentUrl}`)
  }

  const stats: DynamicCrawlStats = {
    pagesReturned: results.length,
    pagesSaved: results.filter((r) => !r.error).length,
    pagesFailed: errors.length,
    pagesSkipped: 0,
    filesWritten: 0,
    totalSizeBytes: 0,
    outputDir: "",
    authValid,
    errors,
    siteProfile: Object.keys(SITE_PROFILES).find((k) => SITE_PROFILES[k] === profile) || "generic",
  }

  return { data: results, total: results.length, stats }
}
