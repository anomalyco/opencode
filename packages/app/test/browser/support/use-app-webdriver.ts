import { afterAll, beforeAll } from "vitest"
import type { WebDriver } from "selenium-webdriver"
import { WORKOS_SESSION_COOKIE_NAME } from "@veritly/auth-shared"
import { createSdk, getCurrentProject, sessionPath, serverUrl } from "../../../e2e/utils"
import { mintE2eSealedSessionFromWorkos } from "../../../e2e/workos-auth"
import { promptSelector } from "../../../e2e/selectors"
import { startStandaloneSelenium } from "../../support/selenium-standalone"
import { By, waitVisible } from "./wd-wait"

function requireAppOrigin(): string {
  const b = process.env.PLAYWRIGHT_BASE_URL?.trim()
  if (!b) throw new Error("PLAYWRIGHT_BASE_URL is required — call useFullAppStack() in the file's root describe before useAppWebDriver()")
  return b.replace(/\/$/, "")
}

async function seedServerAndModel(driver: WebDriver, origin: string, projectId: string) {
  await driver.get(origin)
  await driver.executeScript(
    `(() => {
      const args = arguments[0]
      const key = "opencode.global.dat:server"
      const raw = localStorage.getItem(key)
      let parsed
      try {
        parsed = raw ? JSON.parse(raw) : undefined
      } catch {
        parsed = undefined
      }
      const store = parsed && typeof parsed === "object" ? parsed : {}
      const list = Array.isArray(store.list) ? store.list : []
      const lastProject = store.lastProject && typeof store.lastProject === "object" ? store.lastProject : {}
      const nextLast = { ...lastProject }
      nextLast.local = args.directory
      nextLast[args.serverUrl] = args.directory
      localStorage.setItem(key, JSON.stringify({ list, lastProject: nextLast }))
    })()`,
    { directory: projectId, serverUrl: serverUrl() },
  )
  const model = JSON.stringify({
    recent: [{ providerID: "openai", modelID: "llama3.2:1b" }],
    user: [],
    variant: {},
  })
  await driver.executeScript(`localStorage.setItem("opencode.global.dat:model", arguments[0])`, model)
}

async function applyWorkosCookie(driver: WebDriver, origin: string) {
  const seal = await mintE2eSealedSessionFromWorkos()
  await driver.get(origin)
  const host = new URL(origin).hostname
  await driver.manage().addCookie({
    name: WORKOS_SESSION_COOKIE_NAME,
    value: seal,
    domain: host,
    path: "/",
    httpOnly: true,
    secure: false,
  })
}

/** WorkOS + storage seed + session URL for any project id (e.g. freshly created). */
export async function openProjectSession(driver: WebDriver, origin: string, projectId: string, sessionId?: string) {
  await applyWorkosCookie(driver, origin)
  await seedServerAndModel(driver, origin, projectId)
  await driver.get(`${origin}${sessionPath(projectId, sessionId)}`)
  await waitVisible(driver, By.css(promptSelector))
  await driver.manage().window().setRect({ width: 1600, height: 1000, x: 0, y: 0 })
}

/**
 * Vitest file hook: Selenium standalone + OpenCode-backed project + `gotoSession` / `sdk` (WebDriver migration path).
 * Requires Vite + API already running (`useFullAppStack()` in the same `describe`, or dev) and the same env as Playwright (`PLAYWRIGHT_BASE_URL`, WorkOS, etc.).
 */
export function useAppWebDriver() {
  let driver: WebDriver | undefined
  let stop: (() => Promise<void>) | undefined
  const project = { id: "", directory: "" }
  let sdk: ReturnType<typeof createSdk> | undefined

  beforeAll(async () => {
    const s = await startStandaloneSelenium()
    driver = s.driver
    stop = s.stop
    const p = await getCurrentProject()
    project.id = p.id
    project.directory = p.directory
    sdk = createSdk(project)
  }, 300_000)

  afterAll(async () => {
    if (stop) await stop()
  }, 120_000)

  const gotoSession = async (sessionId?: string) => {
    const d = driver
    if (!d) throw new Error("driver missing")
    await openProjectSession(d, requireAppOrigin(), project.id, sessionId)
  }

  return {
    get origin() {
      return requireAppOrigin()
    },
    get driver(): WebDriver {
      if (!driver) throw new Error("WebDriver not ready")
      return driver
    },
    project,
    get sdk() {
      if (!sdk) throw new Error("sdk not ready")
      return sdk
    },
    gotoSession,
  }
}
