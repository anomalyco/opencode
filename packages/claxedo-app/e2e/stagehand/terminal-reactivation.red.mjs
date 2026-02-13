import assert from "node:assert/strict"
import fs from "node:fs"
import { Stagehand } from "@browserbasehq/stagehand"

const loadEnvFile = (path) => {
  if (!fs.existsSync(path)) return
  const text = fs.readFileSync(path, "utf8")
  for (const line of text.split(/\r?\n/)) {
    const raw = line.trim()
    if (!raw || raw.startsWith("#")) continue
    const idx = raw.indexOf("=")
    if (idx <= 0) continue
    const key = raw.slice(0, idx).trim()
    if (!key || process.env[key] !== undefined) continue
    const value = raw.slice(idx + 1).trim()
    process.env[key] = value
  }
}

loadEnvFile(".env.local")
loadEnvFile(".env")

const baseURL = process.env.STAGEHAND_BASE_URL ?? "http://127.0.0.1:3000"
const workspaceDir = process.env.STAGEHAND_WORKSPACE_DIR ?? "/Users/yashvardhansingh/test/opencode"
const modelName = process.env.STAGEHAND_MODEL ?? "openai/gpt-4.1"
const splitCloseFlow = process.env.STAGEHAND_SPLIT_CLOSE_FLOW === "1" || process.env.STAGEHAND_EXPECT_BROKEN === "1"
const modelApiKey = process.env.OPENAI_API_KEY
const modelClientOptions = modelApiKey ? { apiKey: modelApiKey } : undefined

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function requireReachable(url) {
  const res = await fetch(url).catch(() => undefined)
  if (!res) throw new Error(`Stagehand target not reachable: ${url}`)
  if (!res.ok) throw new Error(`Stagehand target returned ${res.status}: ${url}`)
}

async function clickIfVisible(page, selector) {
  const el = page.locator(selector).first()
  if (!(await el.isVisible().catch(() => false))) return false
  await el.click({ timeout: 5_000 })
  return true
}

function encodeDir(dir) {
  return Buffer.from(dir, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "")
}

async function openProjectIfNeeded(page) {
  const hasTerminalControls = await page
    .locator('button[aria-label="New Terminal"], button[aria-label="New Claude Terminal"]')
    .first()
    .isVisible()
    .catch(() => false)
  if (hasTerminalControls) return

  const route = `${baseURL}/${encodeDir(workspaceDir)}/session`
  await page.goto(route, { waitUntil: "networkidle" })
  const hasAfterDirectRoute = await page
    .locator('button[aria-label="New Terminal"], button[aria-label="New Claude Terminal"]')
    .first()
    .isVisible()
    .catch(() => false)
  if (hasAfterDirectRoute) return

  const recent = page.locator("button", { hasText: "/opencode" }).first()
  if (await recent.isVisible().catch(() => false)) {
    await recent.click({ timeout: 10_000 })
    await page.waitForTimeout(1200)
    return
  }

  // Fallback for other workspace labels.
  const home = page.locator("button", { hasText: "~/test/opencode" }).first()
  if (await home.isVisible().catch(() => false)) {
    await home.click({ timeout: 10_000 })
    await page.waitForTimeout(1200)
  }
}

async function waitForTerminalPaint(page, timeout = 20_000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    const ok = await page.evaluate(() => {
      const root = document.querySelector('[data-component="terminal"]')
      if (!(root instanceof HTMLElement)) return false
      const host = root.querySelector(".xterm")
      const canvas = root.querySelector(".xterm-screen canvas")
      if (!(host instanceof HTMLElement)) return false
      if (!(canvas instanceof HTMLCanvasElement)) return false
      const rect = host.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0
    })
    if (ok) return
    await sleep(200)
  }
  throw new Error(`Timed out waiting for terminal paint after ${timeout}ms`)
}

async function runSplitCloseFlow(page) {
  const hasTerminal = await page.locator('[data-component="terminal"]').first().isVisible().catch(() => false)
  if (!hasTerminal) {
    const opened = await clickIfVisible(page, 'button[aria-label="New Claude Terminal"]')
    assert.equal(opened, true, "Unable to open Claude terminal for split/close flow")
    await page.waitForTimeout(1200)
  }
  await waitForTerminalPaint(page, 40_000)

  const didSplit = await page.evaluate(() => {
    const btn = document.querySelector('[data-pane] button[aria-label="Split vertical"]')
    if (!(btn instanceof HTMLButtonElement)) return false
    btn.click()
    return true
  })
  assert.equal(didSplit, true, "Unable to click Split vertical")

  const start = Date.now()
  while (Date.now() - start < 12_000) {
    const panes = await page.evaluate(() => document.querySelectorAll("[data-pane]").length)
    if (panes >= 2) break
    await sleep(150)
  }
  const panesAfterSplit = await page.evaluate(() => document.querySelectorAll("[data-pane]").length)
  assert.ok(panesAfterSplit >= 2, `Split did not create second pane (panes=${panesAfterSplit})`)

  const closeState = await page.evaluate(() => {
    const panes = Array.from(document.querySelectorAll<HTMLElement>("[data-pane]"))
    const pane = panes.at(-1)
    if (pane instanceof HTMLElement) {
      const btn = pane.querySelector<HTMLButtonElement>('button[aria-label="Close pane"]')
      if (btn instanceof HTMLButtonElement) {
        btn.click()
        return {
          clicked: true,
          mode: "close-button",
          panes: panes.length,
          terminals: document.querySelectorAll('[data-component="terminal"]').length,
        }
      }
    }
    return {
      clicked: false,
      panes: panes.length,
      terminals: document.querySelectorAll('[data-component="terminal"]').length,
    }
  })
  assert.equal(closeState.clicked, true, `Unable to close split pane: ${JSON.stringify(closeState)}`)
  await page.waitForTimeout(800)
  await waitForTerminalPaint(page)
}

async function runAiExpectedCheck(stagehand, page, expectation) {
  const view = await stagehand.extract(
    `We executed this deterministic flow: ${expectation}. Now inspect only the active terminal area and judge whether rendering is correct. Return exactly this format: ok=<true|false>;issue=<short reason>. Return ok=false if rendering is blank, collapsed to strips, gibberish, missing canvas, or clearly not what a normal terminal render should look like.`,
    {
      page,
      timeout: 30_000,
      selector: '[data-component="terminal"]',
    },
  )
  const text = String(view?.extraction ?? "")
  const ok = /ok=(true|false)/i.exec(text)?.[1]?.toLowerCase() === "true"
  const issue = /issue=([^;]+)/i.exec(text)?.[1]?.trim() ?? text.trim()
  return {
    ok,
    issue,
    raw: text,
  }
}

async function captureTerminalState(page) {
  return page.evaluate(() => {
    const root = document.querySelector('[data-component="terminal"]')
    if (!(root instanceof HTMLElement)) {
      return {
        hasTerminal: false,
        hasHost: false,
        hasCanvas: false,
        width: 0,
        height: 0,
        rowsTextLen: 0,
        rowsChildren: 0,
      }
    }
    const host = root.querySelector(".xterm")
    const canvas = root.querySelector(".xterm-screen canvas")
    const rows = root.querySelector(".xterm-rows")
    const rect = host instanceof HTMLElement ? host.getBoundingClientRect() : new DOMRect(0, 0, 0, 0)
    return {
      hasTerminal: true,
      hasHost: host instanceof HTMLElement,
      hasCanvas: canvas instanceof HTMLCanvasElement,
      width: rect.width,
      height: rect.height,
      rowsTextLen: rows?.textContent?.length ?? 0,
      rowsChildren: rows?.children?.length ?? 0,
    }
  })
}

const main = async () => {
  const stagehand = new Stagehand({
    env: "LOCAL",
    modelName,
    modelClientOptions,
    verbose: 1,
  })
  try {
    await requireReachable(baseURL)
    await stagehand.init()
    const page = await stagehand.context.newPage()
    await page.goto(baseURL, { waitUntil: "networkidle" })

    // Dismiss common first-run dialogs if present.
    await clickIfVisible(page, 'button:has-text("Skip")')
    await clickIfVisible(page, 'button:has-text("Continue")')
    await openProjectIfNeeded(page)

    const hasTerminal = await page.locator('[data-component="terminal"]').first().isVisible().catch(() => false)
    if (!hasTerminal) {
      const created =
        (await clickIfVisible(page, 'button[aria-label="New Claude Terminal"]')) ||
        (await clickIfVisible(page, 'button[aria-label="New Terminal"]'))
      assert.equal(created, true, "Unable to create initial terminal tab")
    }

    await waitForTerminalPaint(page)
    const term = page.locator('[data-component="terminal"]').first()
    await term.click({ timeout: 10_000 })
    await page.type('[data-component="terminal"]', "echo __stagehand_reactivation__\n")
    await page.waitForTimeout(400)

    if (splitCloseFlow) {
      await runSplitCloseFlow(page)
    } else {
      // Switch away and back by creating another tab and re-selecting the first terminal tab.
      const second =
        (await clickIfVisible(page, 'button[aria-label="New Terminal"]')) ||
        (await clickIfVisible(page, 'button[aria-label="New Claude Terminal"]'))
      assert.equal(second, true, "Unable to create second tab for reactivation flow")

      await page.waitForTimeout(700)
      const switchedBack = await page.evaluate(() => {
        const tabs = Array.from(document.querySelectorAll("div")).filter((el) => {
          const text = el.textContent?.trim()
          if (!text) return false
          if (!el.className.includes("cursor-pointer")) return false
          return /^Claude|^Terminal|^Codex/i.test(text)
        })
        const target = tabs.find((el) => /^Claude|^Terminal/i.test(el.textContent?.trim() ?? ""))
        if (!(target instanceof HTMLElement)) return false
        target.click()
        return true
      })
      assert.equal(switchedBack, true, "Unable to switch back to original terminal tab")
      await waitForTerminalPaint(page)
    }

    const expectedFlow = splitCloseFlow
      ? "open Claude terminal, split active terminal vertically, close newly created split pane, keep original terminal visible"
      : "open terminal, switch away, switch back"
    const visualBefore = await runAiExpectedCheck(stagehand, page, expectedFlow)
    const stateBefore = await captureTerminalState(page)
    await page.evaluate(() => window.dispatchEvent(new Event("resize")))
    await page.waitForTimeout(700)
    const visualAfterResize = await runAiExpectedCheck(stagehand, page, `${expectedFlow}, then dispatch window resize`)
    const stateAfterResize = await captureTerminalState(page)

    const paintableBefore =
      stateBefore.hasTerminal &&
      stateBefore.hasHost &&
      stateBefore.hasCanvas &&
      stateBefore.width > 0 &&
      stateBefore.height > 0
    const paintableAfter =
      stateAfterResize.hasTerminal &&
      stateAfterResize.hasHost &&
      stateAfterResize.hasCanvas &&
      stateAfterResize.width > 0 &&
      stateAfterResize.height > 0
    const brokenBefore = !paintableBefore || !visualBefore.ok
    const healedByResize = brokenBefore && paintableAfter && visualAfterResize.ok

    if (splitCloseFlow) {
      // Red flow oracle: deterministic actions, AI judgement first, deterministic confirms.
      assert.equal(
        visualBefore.ok,
        false,
        `AI judged rendering as correct after split-close flow. ai=${JSON.stringify(visualBefore)} state=${JSON.stringify(stateBefore)}`,
      )
      assert.equal(
        paintableBefore,
        false,
        true,
        `Deterministic checks did not confirm breakage after AI flagged it. before=${JSON.stringify(stateBefore)} ai=${JSON.stringify(visualBefore)} healedByResize=${healedByResize}`,
      )
    } else {
      assert.equal(visualBefore.ok, true, `AI expected-check failed: ${visualBefore.issue}`)
      assert.equal(
        brokenBefore,
        false,
        `Terminal render degraded after flow. before=${JSON.stringify(stateBefore)} ai=${JSON.stringify(visualBefore)} healedByResize=${healedByResize}`,
      )
    }

    console.log("Stagehand terminal-reactivation visual check passed", {
      flow: splitCloseFlow ? "split-close" : "tab-reactivation",
      before: { state: stateBefore, visual: visualBefore },
      afterResize: { state: stateAfterResize, visual: visualAfterResize },
      healedByResize,
    })
  } finally {
    await stagehand.close()
  }
}

await main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
