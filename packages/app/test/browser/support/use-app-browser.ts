import { afterAll, beforeAll } from "vitest"
import { chromium, type Browser, type BrowserContext, type Page } from "playwright"
import { WORKOS_SESSION_COOKIE_NAME } from "@veritly/auth-shared"
import { createSdk, getCurrentProject, sessionPath, serverUrl } from "../../../e2e/utils"
import { mintE2eSealedSessionFromWorkos } from "../../../e2e/workos-auth"
import { promptSelector } from "../../../e2e/selectors"
import { By, waitVisible } from "./wd-wait"

function requireAppOrigin(): string {
  const b = process.env.PLAYWRIGHT_BASE_URL?.trim()
  if (!b)
    throw new Error(
      "PLAYWRIGHT_BASE_URL is required — call useE2eStack() in the file's root describe before useAppBrowser()",
    )
  return b.replace(/\/$/, "")
}

function headless(): boolean {
  if (process.env.PW_HEADLESS === "0") return false
  return true
}

async function seedServerAndModel(page: Page, origin: string, projectId: string) {
  await page.goto(origin)
  await page.evaluate(
    (args: { directory: string; serverUrl: string }) => {
      const key = "opencode.global.dat:server"
      const raw = localStorage.getItem(key)
      let parsed: unknown
      try {
        parsed = raw ? JSON.parse(raw) : undefined
      } catch {
        parsed = undefined
      }
      const store = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {}
      const list = Array.isArray(store.list) ? store.list : []
      const lastProject =
        store.lastProject && typeof store.lastProject === "object" ? (store.lastProject as Record<string, unknown>) : {}
      const nextLast = { ...lastProject }
      nextLast.local = args.directory
      nextLast[args.serverUrl] = args.directory
      localStorage.setItem(key, JSON.stringify({ list, lastProject: nextLast }))
    },
    { directory: projectId, serverUrl: serverUrl() },
  )
  const model = JSON.stringify({
    recent: [{ providerID: "openai", modelID: "llama3.2:1b" }],
    user: [],
    variant: {},
  })
  await page.evaluate((m: string) => localStorage.setItem("opencode.global.dat:model", m), model)
}

async function applyWorkosCookie(page: Page, origin: string) {
  const seal = await mintE2eSealedSessionFromWorkos()
  await page.goto(origin)
  const base = origin.replace(/\/$/, "")
  await page.context().addCookies([
    {
      name: WORKOS_SESSION_COOKIE_NAME,
      value: seal,
      url: `${base}/`,
      httpOnly: true,
      secure: base.startsWith("https:"),
    },
  ])
}

/** WorkOS + storage seed + session URL for any project id (e.g. freshly created). */
export async function openProjectSession(page: Page, origin: string, projectId: string, sessionId?: string) {
  await applyWorkosCookie(page, origin)
  await seedServerAndModel(page, origin, projectId)
  await page.goto(`${origin}${sessionPath(projectId, sessionId)}`)
  await waitVisible(page, By.css(promptSelector))
  await page.setViewportSize({ width: 1600, height: 1000 })
}

/**
 * Vitest file hook: host Chromium + OpenCode-backed project + `gotoSession` / `sdk`.
 * Requires Vite + API already running (`useE2eStack()` in the same `describe`, or dev).
 */
export function useAppBrowser() {
  let browser: Browser | undefined
  let context: BrowserContext | undefined
  let page: Page | undefined
  const project = { id: "", directory: "" }
  let sdk: ReturnType<typeof createSdk> | undefined

  beforeAll(async () => {
    browser = await chromium.launch({ headless: headless() })
    const origin = requireAppOrigin()
    context = await browser.newContext({
      baseURL: origin,
      viewport: { width: 1600, height: 1000 },
    })
    page = await context.newPage()
    const p = await getCurrentProject()
    project.id = p.id
    project.directory = p.directory
    sdk = createSdk(project)
  }, 300_000)

  afterAll(async () => {
    if (context) await context.close().catch(() => undefined)
    if (browser) await browser.close().catch(() => undefined)
  }, 120_000)

  const gotoSession = async (sessionId?: string) => {
    const pg = page
    if (!pg) throw new Error("page missing")
    await openProjectSession(pg, requireAppOrigin(), project.id, sessionId)
  }

  return {
    get origin() {
      return requireAppOrigin()
    },
    get page(): Page {
      if (!page) throw new Error("page not ready")
      return page
    },
    get context(): BrowserContext {
      if (!context) throw new Error("context not ready")
      return context
    },
    project,
    get sdk() {
      if (!sdk) throw new Error("sdk not ready")
      return sdk
    },
    gotoSession,
  }
}
