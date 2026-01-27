/**
 * ULTRAWORK Browser - Browser Automation Layer
 *
 * Enables the orchestrator to interact with AI web interfaces
 * that don't have APIs, using browser automation.
 *
 * Supports:
 * - ChatGPT web interface (chatgpt.com)
 * - Gemini web interface (gemini.google.com)
 * - Grok on X.com (x.com/i/grok)
 * - Claude.ai web interface
 * - Any custom web AI interface
 *
 * Inspired by:
 * - AgenticSeek's browser automation ("Local Manus AI")
 * - OpenHands' BrowserGym integration
 * - ClawdBot's browser automation skill
 *
 * NOTE: This module provides the interface and routing logic.
 * Actual browser automation requires Playwright to be installed:
 *   bun add playwright
 *
 * For CI/CD environments, use headless mode.
 * For desktop environments, supports visible browser for debugging.
 */

import { Log } from "../util/log"

export namespace UltraworkBrowser {
  const log = Log.create({ service: "ultrawork.browser" })

  /**
   * Browser session state
   */
  export interface BrowserSession {
    id: string
    target: BrowserTarget
    status: "idle" | "navigating" | "interacting" | "waiting" | "error"
    startedAt: number
    lastAction: string
    cookies: Record<string, string>
  }

  /**
   * Supported browser targets
   */
  export type BrowserTarget =
    | "chatgpt"
    | "gemini"
    | "grok"
    | "claude"
    | "deepseek"
    | "custom"

  /**
   * Browser action types
   */
  export interface BrowserAction {
    type: "navigate" | "click" | "type" | "wait" | "screenshot" | "extract" | "submit"
    selector?: string
    value?: string
    url?: string
    waitMs?: number
  }

  /**
   * Target URL mapping
   */
  const TARGET_URLS: Record<BrowserTarget, string> = {
    chatgpt: "https://chatgpt.com",
    gemini: "https://gemini.google.com",
    grok: "https://x.com/i/grok",
    claude: "https://claude.ai",
    deepseek: "https://chat.deepseek.com",
    custom: "",
  }

  /**
   * Target-specific selectors for common actions
   */
  const TARGET_SELECTORS: Record<
    BrowserTarget,
    {
      inputField: string
      submitButton: string
      responseArea: string
      waitForResponse: string
    }
  > = {
    chatgpt: {
      inputField: "#prompt-textarea",
      submitButton: '[data-testid="send-button"]',
      responseArea: '[data-message-author-role="assistant"]',
      waitForResponse: '[data-message-author-role="assistant"]',
    },
    gemini: {
      inputField: ".ql-editor",
      submitButton: '[aria-label="Send message"]',
      responseArea: ".response-container",
      waitForResponse: ".response-container",
    },
    grok: {
      inputField: '[data-testid="grok-composer"]',
      submitButton: '[data-testid="grok-send-button"]',
      responseArea: '[data-testid="grok-response"]',
      waitForResponse: '[data-testid="grok-response"]',
    },
    claude: {
      inputField: '[contenteditable="true"]',
      submitButton: '[aria-label="Send Message"]',
      responseArea: ".font-claude-message",
      waitForResponse: ".font-claude-message",
    },
    deepseek: {
      inputField: "#chat-input",
      submitButton: "#send-button",
      responseArea: ".markdown-body",
      waitForResponse: ".markdown-body",
    },
    custom: {
      inputField: "textarea",
      submitButton: 'button[type="submit"]',
      responseArea: ".response",
      waitForResponse: ".response",
    },
  }

  // Active sessions
  const sessions = new Map<string, BrowserSession>()

  /**
   * Check if Playwright is available
   */
  export async function isPlaywrightAvailable(): Promise<boolean> {
    try {
      await import("playwright")
      return true
    } catch {
      return false
    }
  }

  /**
   * Create a new browser session for a target AI
   */
  export function createSession(target: BrowserTarget, customUrl?: string): BrowserSession {
    const session: BrowserSession = {
      id: `browser-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      target,
      status: "idle",
      startedAt: Date.now(),
      lastAction: "created",
      cookies: {},
    }

    if (target === "custom" && customUrl) {
      TARGET_URLS.custom = customUrl
    }

    sessions.set(session.id, session)
    log.info("browser session created", { id: session.id, target })
    return session
  }

  /**
   * Build a sequence of browser actions to send a prompt
   * to a target AI web interface and get the response.
   */
  export function buildPromptActions(
    target: BrowserTarget,
    prompt: string,
  ): BrowserAction[] {
    const selectors = TARGET_SELECTORS[target]
    const url = TARGET_URLS[target]

    return [
      { type: "navigate", url },
      { type: "wait", waitMs: 2000 }, // Wait for page load
      { type: "click", selector: selectors.inputField },
      { type: "type", selector: selectors.inputField, value: prompt },
      { type: "wait", waitMs: 500 },
      { type: "click", selector: selectors.submitButton },
      { type: "wait", selector: selectors.waitForResponse, waitMs: 30000 }, // Wait up to 30s for response
      { type: "extract", selector: selectors.responseArea },
    ]
  }

  /**
   * Execute browser actions using Playwright.
   *
   * This is the core execution engine. It takes a sequence of
   * actions and executes them against a real browser instance.
   *
   * Returns the extracted content from the last 'extract' action.
   */
  export async function executeActions(
    sessionId: string,
    actions: BrowserAction[],
    options: {
      headless?: boolean
      timeout?: number
    } = {},
  ): Promise<string> {
    const session = sessions.get(sessionId)
    if (!session) throw new Error(`Browser session not found: ${sessionId}`)

    const hasPlaywright = await isPlaywrightAvailable()
    if (!hasPlaywright) {
      log.warn("Playwright not installed - browser automation unavailable")
      return buildPlaywrightInstallGuide()
    }

    const { chromium } = await import("playwright")
    const headless = options.headless ?? true
    const timeout = options.timeout ?? 60_000

    let extractedContent = ""

    const browser = await chromium.launch({ headless })
    const context = await browser.newContext()
    const page = await context.newPage()
    page.setDefaultTimeout(timeout)

    try {
      session.status = "navigating"

      for (const action of actions) {
        session.lastAction = `${action.type}:${action.selector ?? action.url ?? ""}`

        switch (action.type) {
          case "navigate":
            if (action.url) {
              await page.goto(action.url, { waitUntil: "domcontentloaded" })
            }
            break

          case "click":
            if (action.selector) {
              session.status = "interacting"
              await page.click(action.selector)
            }
            break

          case "type":
            if (action.selector && action.value) {
              session.status = "interacting"
              await page.fill(action.selector, action.value)
            }
            break

          case "wait":
            session.status = "waiting"
            if (action.selector) {
              await page.waitForSelector(action.selector, {
                timeout: action.waitMs ?? 30_000,
              })
            } else if (action.waitMs) {
              await new Promise((r) => setTimeout(r, action.waitMs))
            }
            break

          case "screenshot":
            await page.screenshot({ path: `/tmp/ultrawork-${session.id}.png` })
            break

          case "extract":
            if (action.selector) {
              const elements = await page.$$(action.selector)
              const lastElement = elements[elements.length - 1]
              if (lastElement) {
                extractedContent = (await lastElement.textContent()) ?? ""
              }
            }
            break

          case "submit":
            if (action.selector) {
              await page.click(action.selector)
            }
            break
        }
      }

      session.status = "idle"
    } catch (error: any) {
      session.status = "error"
      log.error("browser action failed", {
        sessionId,
        lastAction: session.lastAction,
        error: error.message,
      })
      throw error
    } finally {
      await browser.close()
    }

    return extractedContent
  }

  /**
   * Send a prompt to an AI via its web interface and get the response.
   * This is the high-level convenience method.
   */
  export async function sendPrompt(
    target: BrowserTarget,
    prompt: string,
    options: { headless?: boolean } = {},
  ): Promise<string> {
    const session = createSession(target)
    const actions = buildPromptActions(target, prompt)

    try {
      const response = await executeActions(session.id, actions, options)
      closeSession(session.id)
      return response
    } catch (error) {
      closeSession(session.id)
      throw error
    }
  }

  /**
   * Close a browser session
   */
  export function closeSession(sessionId: string): void {
    sessions.delete(sessionId)
    log.info("browser session closed", { sessionId })
  }

  /**
   * Get all active sessions
   */
  export function activeSessions(): BrowserSession[] {
    return Array.from(sessions.values())
  }

  /**
   * Get the URL for a browser target
   */
  export function getTargetUrl(target: BrowserTarget): string {
    return TARGET_URLS[target]
  }

  // --- Internal helpers ---

  function buildPlaywrightInstallGuide(): string {
    return [
      "Browser automation requires Playwright. To install:",
      "",
      "  bun add playwright",
      "  bunx playwright install chromium",
      "",
      "For your system (Legion laptop with NVIDIA 5090):",
      "  - Headless mode works out of the box",
      "  - For visible browser debugging, ensure X11/Wayland is available",
      "  - GPU acceleration is automatically used when available",
      "",
      "After installation, browser automation will be fully functional.",
    ].join("\n")
  }
}
