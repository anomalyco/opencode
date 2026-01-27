import { Log } from "../util/log"
import { chromium } from "playwright"

export namespace Browser {
  const log = Log.create({ service: "browser" })

  export interface Page {
    url: string
    title: string
    screenshot?: string
  }

  export interface Element {
    selector: string
    text: string
    bounds: { x: number; y: number; width: number; height: number }
  }

  export interface Result {
    success: boolean
    data?: any
    error?: string
    screenshot?: string
    content?: string
  }

  // Browser session management
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null
  let page: any | null = null

  async function ensureBrowser(): Promise<void> {
    if (browser && page) return

    try {
      log.info("Launching Chromium browser")
      browser = await chromium.launch({
        headless: true,
      })
      page = await browser.newPage()
      log.info("Browser launched successfully")
    } catch (error) {
      log.error("Failed to launch browser", { error })
      throw error
    }
  }

  export async function navigate(options: { url: string }): Promise<Result> {
    try {
      await ensureBrowser()
      if (!page) throw new Error("Page not initialized")

      log.info("navigate", { url: options.url })

      await page.goto(options.url, { waitUntil: "domcontentloaded", timeout: 30000 })

      const title = await page.title()
      const url = page.url()

      return {
        success: true,
        data: { url, title }
      }
    } catch (error) {
      log.error("navigate failed", { error })
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  export async function screenshot(options: { fullPage?: boolean } = {}): Promise<Result> {
    try {
      await ensureBrowser()
      if (!page) throw new Error("Page not initialized")

      log.info("screenshot", options)

      const screenshot = await page.screenshot({
        fullPage: options.fullPage ?? false,
        type: "png"
      })

      const base64 = screenshot.toString("base64")

      return {
        success: true,
        screenshot: base64
      }
    } catch (error) {
      log.error("screenshot failed", { error })
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  export async function click(options: { selector: string }): Promise<Result> {
    try {
      await ensureBrowser()
      if (!page) throw new Error("Page not initialized")

      log.info("click", options)

      await page.click(options.selector, { timeout: 5000 })

      return {
        success: true
      }
    } catch (error) {
      log.error("click failed", { error })
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  export async function type(options: { selector: string; text: string }): Promise<Result> {
    try {
      await ensureBrowser()
      if (!page) throw new Error("Page not initialized")

      log.info("type", options)

      await page.fill(options.selector, options.text, { timeout: 5000 })

      return {
        success: true
      }
    } catch (error) {
      log.error("type failed", { error })
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  export async function scroll(options: {
    direction: 'up' | 'down' | 'left' | 'right'
    amount?: number
  }): Promise<Result> {
    try {
      await ensureBrowser()
      if (!page) throw new Error("Page not initialized")

      const amount = options.amount ?? 100
      log.info("scroll", { ...options, amount })

      // Scroll using JavaScript
      const scrollAmounts = {
        up: -amount,
        down: amount,
        left: -amount,
        right: amount
      }

      await page.evaluate((scrollBy: number) => {
        window.scrollBy(0, scrollBy)
      }, scrollAmounts[options.direction])

      return {
        success: true
      }
    } catch (error) {
      log.error("scroll failed", { error })
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  export async function extractContent(options: { selector?: string } = {}): Promise<Result> {
    try {
      await ensureBrowser()
      if (!page) throw new Error("Page not initialized")

      log.info("extractContent", options)

      let content: string

      if (options.selector) {
        const element = await page.$(options.selector)
        if (!element) {
          return {
            success: false,
            error: `Element not found: ${options.selector}`
          }
        }
        content = await element.evaluate((el: any) => el.textContent || "") as string
      } else {
        content = await page.evaluate(() => document.body.innerText)
      }

      return {
        success: true,
        content
      }
    } catch (error) {
      log.error("extractContent failed", { error })
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  export async function executeScript(options: { script: string }): Promise<Result> {
    try {
      await ensureBrowser()
      if (!page) throw new Error("Page not initialized")

      log.info("executeScript", { script: options.script.substring(0, 100) })

      const result = await page.evaluate(options.script)

      return {
        success: true,
        data: result
      }
    } catch (error) {
      log.error("executeScript failed", { error })
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  export async function getTitle(): Promise<Result> {
    try {
      await ensureBrowser()
      if (!page) throw new Error("Page not initialized")

      const title = await page.title()

      return {
        success: true,
        data: title
      }
    } catch (error) {
      log.error("getTitle failed", { error })
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  export async function getURL(): Promise<Result> {
    try {
      await ensureBrowser()
      if (!page) throw new Error("Page not initialized")

      const url = page.url()

      return {
        success: true,
        data: url
      }
    } catch (error) {
      log.error("getURL failed", { error })
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  export async function getContent(): Promise<Result> {
    try {
      await ensureBrowser()
      if (!page) throw new Error("Page not initialized")

      const content = await page.content()

      return {
        success: true,
        data: content
      }
    } catch (error) {
      log.error("getContent failed", { error })
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  export async function querySelector(options: { query: string }): Promise<Result> {
    try {
      await ensureBrowser()
      if (!page) throw new Error("Page not initialized")

      log.info("querySelector", options)

      const elements = await page.$$(options.query)
      const results: Element[] = []

      for (const el of elements) {
        const text = await el.evaluate((el: any) => el.textContent || "")
        const bounds = await el.boundingBox()

        if (bounds) {
          results.push({
            selector: options.query,
            text: text as string,
            bounds: {
              x: bounds.x,
              y: bounds.y,
              width: bounds.width,
              height: bounds.height
            }
          })
        }
      }

      return {
        success: true,
        data: results
      }
    } catch (error) {
      log.error("querySelector failed", { error })
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  export async function waitForSelector(options: {
    selector: string
    timeout: number
  }): Promise<Result> {
    try {
      await ensureBrowser()
      if (!page) throw new Error("Page not initialized")

      log.info("waitForSelector", options)

      await page.waitForSelector(options.selector, {
        timeout: options.timeout
      })

      return {
        success: true
      }
    } catch (error) {
      log.error("waitForSelector failed", { error })
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  export async function evaluateJavaScript(options: { code: string }): Promise<Result> {
    try {
      await ensureBrowser()
      if (!page) throw new Error("Page not initialized")

      log.info("evaluateJavaScript", { code: options.code.substring(0, 100) })

      const result = await page.evaluate(options.code)

      return {
        success: true,
        data: result
      }
    } catch (error) {
      log.error("evaluateJavaScript failed", { error })
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  export async function close(): Promise<Result> {
    try {
      log.info("close")

      if (browser) {
        await browser.close()
        browser = null
        page = null
      }

      return {
        success: true
      }
    } catch (error) {
      log.error("close failed", { error })
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }
}
