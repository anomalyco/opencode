import { Log } from "@/util/log"
import type { Browser, BrowserContext, Page, ElementHandle } from "playwright"

const log = Log.create({ service: "browser" })

const DEFAULT_CONFIG: BrowserConfig = {
  maxPages: 10,
  maxMemoryMb: 512,
  idleTimeoutMinutes: 30,
  screenshotMaxBytes: 4 * 1024 * 1024,
  scriptMaxBytes: 10 * 1024 * 1024,
  scriptTimeoutMs: 5000,
  navigationTimeoutMs: 30000,
  elementTimeoutMs: 10000,
  retryAttempts: 3,
  retryDelayMs: 1000,
  browser: 'chromium',
  headed: true,  // Headed mode by default - user sees the browser
}

interface BrowserStateData {
  browser: Browser | null
  context: BrowserContext | null
  lastActivity: number
  pageCount: number
}

let browserStateData: BrowserStateData = {
  browser: null,
  context: null,
  lastActivity: Date.now(),
  pageCount: 0,
}

async function closeBrowser(state: BrowserStateData) {
  if (state.context) {
    try {
      const pages = await state.context.pages()
      for (const page of pages) {
        try {
          await page.close().catch(() => {})
        } catch {}
      }
    } catch {}
    state.context = null
  }
  
  if (state.browser) {
    try {
      await state.browser.close().catch(() => {})
    } catch {}
    state.browser = null
  }
}

export interface BrowserConfig {
  maxPages: number
  maxMemoryMb: number
  idleTimeoutMinutes: number
  screenshotMaxBytes: number
  scriptMaxBytes: number
  scriptTimeoutMs: number
  navigationTimeoutMs: number
  elementTimeoutMs: number
  retryAttempts: number
  retryDelayMs: number
  browser?: 'chromium' | 'firefox' | 'webkit'
  headed?: boolean
}

export interface BrowserPageInfo {
  id: string
  url: string
  title: string
}

export interface BrowserScreenshotResult {
  base64: string
  width: number
  height: number
  size: number
}

export interface BrowserEvaluateResult<T = any> {
  result: T
  console: Array<{ type: 'log' | 'error' | 'warn' | 'info'; text: string }>
}

export type BrowserErrorCode = 
  | 'NAVIGATION_FAILED'
  | 'ELEMENT_NOT_FOUND'
  | 'ELEMENT_STALE'
  | 'CONTEXT_CLOSED'
  | 'RESOURCE_EXCEEDED'
  | 'JAVASCRIPT_ERROR'
  | 'PERMISSION_DENIED'
  | 'INVALID_URL'
  | 'TIMEOUT'
  | 'BROWSER_CLOSED'
  | 'SCRIPT_ERROR'
  | 'NOT_IMPLEMENTED'

export class BrowserError extends Error {
  constructor(
    readonly code: BrowserErrorCode,
    message: string,
    readonly details?: Record<string, any>
  ) {
    super(message)
    this.name = 'BrowserError'
  }
}

async function getBrowser(): Promise<Browser> {
  const state = browserStateData
  
  if (state.browser?.isConnected()) {
    return state.browser
  }
  
  await closeBrowser(state)
  
  const playwright = await import('playwright')
  const browserType = DEFAULT_CONFIG.browser ?? 'chromium'
  const isHeaded = DEFAULT_CONFIG.headed ?? false
  
  let browser: Browser
  switch (browserType) {
    case 'firefox':
      browser = await playwright.firefox.launch({
        headless: !isHeaded,
        args: isHeaded ? [] : [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
        ],
      })
      break
    case 'webkit':
      browser = await playwright.webkit.launch({
        headless: !isHeaded,
        args: isHeaded ? [] : [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
        ],
      })
      break
    default:
      browser = await playwright.chromium.launch({
        headless: !isHeaded,
        channel: isHeaded ? undefined : 'chromium',
        args: isHeaded ? [] : [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-software-rasterizer',
          '--memory-pressure-off',
          '--max-old-space-size=256',
        ],
      })
  }
  
  state.browser = browser
  state.context = await browser.newContext({
    ignoreHTTPSErrors: true,
    locale: 'en-US',
  })
  
  return browser
}

async function getPage(state: BrowserStateData): Promise<Page> {
  if (!state.context) {
    throw new BrowserError('CONTEXT_CLOSED', 'Browser context has been closed')
  }
  
  const pages = await state.context.pages()
  
  if (pages.length > 0) {
    return pages[0]
  }
  
  if (state.pageCount >= DEFAULT_CONFIG.maxPages) {
    throw new BrowserError('RESOURCE_EXCEEDED', `Maximum page limit (${DEFAULT_CONFIG.maxPages}) reached`, {
      maxPages: DEFAULT_CONFIG.maxPages,
    })
  }
  
  const page = await state.context.newPage()
  state.pageCount++
  state.lastActivity = Date.now()
  
  page.on('close', () => {
    state.pageCount = Math.max(0, state.pageCount - 1)
  })
  
  return page
}

async function withRetry<T>(
  fn: () => Promise<T>,
  config: Partial<BrowserConfig> = {}
): Promise<T> {
  const cfg = { ...DEFAULT_CONFIG, ...config }
  let lastError: Error | null = null
  
  for (let attempt = 0; attempt < cfg.retryAttempts; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error as Error
      
      if (error instanceof BrowserError) {
        if (['ELEMENT_NOT_FOUND', 'ELEMENT_STALE'].includes(error.code)) {
          if (attempt < cfg.retryAttempts - 1) {
            await new Promise(resolve => setTimeout(resolve, cfg.retryDelayMs))
            continue
          }
        }
      }
      
      throw error
    }
  }
  
  throw lastError
}

export const BrowserService = {
  name: 'browser',
  
  async getConfig(): Promise<BrowserConfig> {
    return DEFAULT_CONFIG
  },
  
  async navigate(url: string, config: Partial<BrowserConfig> = {}): Promise<BrowserPageInfo> {
    return withRetry(async () => {
      const state = browserStateData
      await getBrowser()
      const page = await getPage(state)
      const pageGuid = (page as any).guid
      
      state.lastActivity = Date.now()
      
      try {
        await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: config.navigationTimeoutMs ?? DEFAULT_CONFIG.navigationTimeoutMs,
        })
      } catch (error) {
        const err = error as Error & { message?: string }
        if (err.message?.includes('net::ERR_NAME_NOT_RESOLVED')) {
          throw new BrowserError('INVALID_URL', `Could not resolve URL: ${url}`, { url })
        }
        if (err.message?.includes('net::ERR_CONNECTION_REFUSED')) {
          throw new BrowserError('NAVIGATION_FAILED', `Connection refused: ${url}`, { url })
        }
        if (err.message?.includes('net::ERR_TIMED_OUT')) {
          throw new BrowserError('TIMEOUT', `Navigation timed out: ${url}`, { url })
        }
        throw new BrowserError('NAVIGATION_FAILED', `Failed to navigate to ${url}: ${err.message}`, { url })
      }
      
      return {
        id: pageGuid,
        url: page.url(),
        title: await page.title(),
      }
    }, config)
  },

  async fill(selector: string, value: string, config: Partial<BrowserConfig> = {}): Promise<{ success: boolean }> {
    return withRetry(async () => {
      const state = browserStateData
      const page = await getPage(state)
      
      state.lastActivity = Date.now()
      
      const element = await findElement(page, selector, config)
      if (!element) {
        throw new BrowserError('ELEMENT_NOT_FOUND', `Element not found: ${selector}`, { selector })
      }
      
      try {
        await element.fill(value, {
          timeout: config.elementTimeoutMs ?? DEFAULT_CONFIG.elementTimeoutMs,
        })
      } catch (error) {
        throw new BrowserError('ELEMENT_STALE', `Element became stale: ${selector}`, { selector })
      }
      
      return { success: true }
    }, config)
  },

  async click(selector: string, config: Partial<BrowserConfig> = {}): Promise<BrowserPageInfo> {
    return withRetry(async () => {
      const state = browserStateData
      const page = await getPage(state)
      const pageGuid = (page as any).guid
      
      state.lastActivity = Date.now()
      
      const element = await findElement(page, selector, config)
      if (!element) {
        throw new BrowserError('ELEMENT_NOT_FOUND', `Element not found: ${selector}`, { selector })
      }
      
      try {
        await element.click({
          timeout: config.elementTimeoutMs ?? DEFAULT_CONFIG.elementTimeoutMs,
        })
      } catch (error) {
        throw new BrowserError('ELEMENT_STALE', `Element became stale: ${selector}`, { selector })
      }
      
      return {
        id: pageGuid,
        url: page.url(),
        title: await page.title(),
      }
    }, config)
  },

  async screenshot(config: Partial<BrowserConfig> = {}): Promise<BrowserScreenshotResult> {
    const state = browserStateData
    const page = await getPage(state)
    
    state.lastActivity = Date.now()
    
    const screenshot = await page.screenshot({
      type: 'png',
      fullPage: false,
    })
    
    if (screenshot.length > DEFAULT_CONFIG.screenshotMaxBytes) {
      throw new BrowserError('RESOURCE_EXCEEDED', 'Screenshot too large', {
        size: screenshot.length,
        maxSize: DEFAULT_CONFIG.screenshotMaxBytes,
      })
    }
    
    const dimensions = await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
    }))
    
    return {
      base64: Buffer.from(screenshot).toString('base64'),
      width: dimensions.width,
      height: dimensions.height,
      size: screenshot.length,
    }
  },
  
  async evaluate<T = any>(script: string, config: Partial<BrowserConfig> = {}): Promise<BrowserEvaluateResult<T>> {
    const state = browserStateData
    const page = await getPage(state)
    
    state.lastActivity = Date.now()
    
    if (script.length > DEFAULT_CONFIG.scriptMaxBytes) {
      throw new BrowserError('RESOURCE_EXCEEDED', 'Script too large', {
        size: script.length,
        maxSize: DEFAULT_CONFIG.scriptMaxBytes,
      })
    }
    
    const consoleMessages: Array<{ type: string; text: string }> = []
    
    page.on('console', (msg: { type: () => string; text: () => string }) => {
      consoleMessages.push({
        type: msg.type(),
        text: msg.text(),
      })
    })
    
    let result: T
    try {
      result = await page.evaluate(
        (code: string) => {
          try {
            return eval(code)
          } catch (e) {
            throw e instanceof Error ? e.message : String(e)
          }
        },
        script
      )
    } catch (error) {
      const err = error as Error & { message?: string }
      throw new BrowserError('JAVASCRIPT_ERROR', `Script error: ${err.message}`, { script })
    }
    
    return {
      result,
      console: consoleMessages.map(c => ({
        type: c.type as 'log' | 'error' | 'warn' | 'info',
        text: c.text,
      })),
    }
  },
  
  async close(): Promise<{ success: boolean }> {
    await closeBrowser(browserStateData)
    return { success: true }
  },
  
  async urls(): Promise<BrowserPageInfo[]> {
    const state = browserStateData
    const urls: BrowserPageInfo[] = []
    
    if (state.context) {
      for (const page of await state.context.pages()) {
        const pageGuid = (page as any).guid
        urls.push({
          id: pageGuid,
          url: page.url(),
          title: await page.title().catch(() => ''),
        })
      }
    }
    
    return urls
  },
  
  async isHealthy(): Promise<boolean> {
    const state = browserStateData
    return state.browser?.isConnected() ?? false
  },
  
  async open(url?: string): Promise<BrowserPageInfo> {
    const state = browserStateData
    await getBrowser()
    const page = await getPage(state)
    const pageGuid = (page as any).guid
    
    state.lastActivity = Date.now()
    
    if (url) {
      try {
        await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: DEFAULT_CONFIG.navigationTimeoutMs,
        })
      } catch (error) {
        const err = error as Error & { message?: string }
        throw new BrowserError('NAVIGATION_FAILED', `Failed to open ${url}: ${err.message}`, { url })
      }
    }
    
    return {
      id: pageGuid,
      url: page.url(),
      title: await page.title(),
    }
  },

  async switchTab(index: number): Promise<BrowserPageInfo> {
    const state = browserStateData
    await getBrowser()
    const pages = await state.context?.pages() || []
    
    if (index < 0 || index >= pages.length) {
      throw new BrowserError('ELEMENT_NOT_FOUND', `Tab index ${index} not found`, { index, total: pages.length })
    }
    
    const page = pages[index]
    const pageGuid = (page as any).guid
    
    await page.bringToFront()
    state.lastActivity = Date.now()
    
    return {
      id: pageGuid,
      url: page.url(),
      title: await page.title(),
    }
  },

  async closeTab(index?: number): Promise<{ remaining: number }> {
    const state = browserStateData
    await getBrowser()
    const pages = await state.context?.pages() || []
    
    const targetIndex = index ?? pages.length - 1
    
    if (targetIndex < 0 || targetIndex >= pages.length) {
      throw new BrowserError('ELEMENT_NOT_FOUND', `Tab index ${targetIndex} not found`, { index: targetIndex, total: pages.length })
    }
    
    const pageToClose = pages[targetIndex]
    await pageToClose.close()
    state.pageCount = Math.max(0, state.pageCount - 1)
    
    const remainingPages = await state.context?.pages() || []
    return { remaining: remainingPages.length }
  },

  async duplicateTab(): Promise<BrowserPageInfo & { newIndex: number }> {
    const state = browserStateData
    await getBrowser()
    const pages = await state.context?.pages() || []
    
    if (pages.length === 0) {
      throw new BrowserError('CONTEXT_CLOSED', 'No tabs to duplicate')
    }
    
    const currentPage = pages[0]
    const currentUrl = currentPage.url()
    const currentTitle = await currentPage.title()
    
    const newPage = await state.context!.newPage()
    if (currentUrl && currentUrl !== 'about:blank') {
      await newPage.goto(currentUrl, { waitUntil: 'domcontentloaded' })
    }
    
    state.pageCount++
    const pageGuid = (newPage as any).guid
    const newIndex = (await state.context?.pages() || []).length - 1
    
    return {
      id: pageGuid,
      url: newPage.url(),
      title: await newPage.title(),
      newIndex,
    }
  },

  async reopenTab(): Promise<{ success: boolean; url: string; title: string }> {
    throw new BrowserError('NOT_IMPLEMENTED', 'Tab reopening requires browser history access')
  },

  async hover(selector: string, timeout?: number): Promise<void> {
    const state = browserStateData
    const page = await getPage(state)
    const element = await findElement(page, selector, { elementTimeoutMs: timeout })
    
    if (!element) {
      throw new BrowserError('ELEMENT_NOT_FOUND', `Element not found: ${selector}`, { selector })
    }
    
    await element.hover()
  },

  async rightClick(selector?: string, x?: number, y?: number): Promise<void> {
    const state = browserStateData
    const page = await getPage(state)
    
    if (selector) {
      const element = await findElement(page, selector)
      if (!element) {
        throw new BrowserError('ELEMENT_NOT_FOUND', `Element not found: ${selector}`, { selector })
      }
      await element.click({ button: 'right' })
    } else if (x !== undefined && y !== undefined) {
      await page.mouse.click(x, y, { button: 'right' })
    } else {
      throw new BrowserError('INVALID_URL', 'Either selector or coordinates required')
    }
  },

  async doubleClick(selector: string, timeout?: number): Promise<void> {
    const state = browserStateData
    const page = await getPage(state)
    const element = await findElement(page, selector, { elementTimeoutMs: timeout })
    
    if (!element) {
      throw new BrowserError('ELEMENT_NOT_FOUND', `Element not found: ${selector}`, { selector })
    }
    
    await element.dblclick()
  },

  async dragDrop(source: string, target: string, delay?: number): Promise<void> {
    const state = browserStateData
    const page = await getPage(state)
    
    const sourceElement = await findElement(page, source)
    const targetElement = await findElement(page, target)
    
    if (!sourceElement) {
      throw new BrowserError('ELEMENT_NOT_FOUND', `Source element not found: ${source}`, { selector: source })
    }
    
    if (!targetElement) {
      throw new BrowserError('ELEMENT_NOT_FOUND', `Target element not found: ${target}`, { selector: target })
    }
    
    const sourceBox = await sourceElement.boundingBox()
    const targetBox = await targetElement.boundingBox()
    
    if (sourceBox && targetBox) {
      await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2)
      await page.mouse.down()
      await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 10 })
      await page.mouse.up()
    }
  },

  async scrollToTop(selector?: string): Promise<void> {
    const state = browserStateData
    const page = await getPage(state)
    
    if (selector) {
      const element = await findElement(page, selector)
      if (element) {
        await element.evaluate((el: Element) => el.scrollIntoView({ block: 'start' }))
      }
    } else {
      await page.evaluate(() => window.scrollTo(0, 0))
    }
  },

  async scrollToBottom(selector?: string): Promise<void> {
    const state = browserStateData
    const page = await getPage(state)
    
    if (selector) {
      const element = await findElement(page, selector)
      if (element) {
        await element.evaluate((el: Element) => el.scrollIntoView({ block: 'end' }))
      }
    } else {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    }
  },

  async scroll(selector: string | undefined, direction: 'up' | 'down' | 'left' | 'right', pixels: number): Promise<void> {
    const state = browserStateData
    const page = await getPage(state)
    
    const scrollAmount = direction === 'up' || direction === 'left' ? -pixels : pixels
    
    if (selector) {
      const element = await findElement(page, selector)
      if (element) {
        await element.evaluate((el: HTMLElement) => {
          el.scrollTop += direction === 'up' || direction === 'down' ? scrollAmount : 0
          el.scrollLeft += direction === 'left' || direction === 'right' ? scrollAmount : 0
        })
      }
    } else {
      await page.evaluate((params: { deltaX: number; deltaY: number }) => {
        window.scrollBy(params.deltaX, params.deltaY)
      }, { deltaX: direction === 'left' || direction === 'right' ? scrollAmount : 0, deltaY: direction === 'up' || direction === 'down' ? scrollAmount : 0 })
    }
  },

  async scrollTo(selector: string, block: 'start' | 'center' | 'end' | 'nearest' = 'center'): Promise<void> {
    const state = browserStateData
    const page = await getPage(state)
    const element = await findElement(page, selector)
    
    if (!element) {
      throw new BrowserError('ELEMENT_NOT_FOUND', `Element not found: ${selector}`, { selector })
    }
    
    await element.scrollIntoViewIfNeeded()
  },

  async check(selector: string, checked: boolean = true): Promise<void> {
    const state = browserStateData
    const page = await getPage(state)
    const element = await findElement(page, selector)
    
    if (!element) {
      throw new BrowserError('ELEMENT_NOT_FOUND', `Element not found: ${selector}`, { selector })
    }
    
    const isChecked = await element.isChecked()
    if (isChecked !== checked) {
      await element.click()
    }
  },

  async select(selector: string, value?: string, label?: string): Promise<{ value: string; selectedLabel: string }> {
    const state = browserStateData
    const page = await getPage(state)
    const element = await findElement(page, selector)
    
    if (!element) {
      throw new BrowserError('ELEMENT_NOT_FOUND', `Element not found: ${selector}`, { selector })
    }
    
    if (value) {
      await element.selectOption({ value })
    } else if (label) {
      await element.selectOption({ label })
    }
    
    const selected = await element.evaluate((el: HTMLSelectElement) => {
      return { value: el.value, label: el.options[el.selectedIndex]?.textContent || '' }
    })
    
    return { value: selected.value, selectedLabel: selected.label }
  },

  async clear(selector: string): Promise<void> {
    const state = browserStateData
    const page = await getPage(state)
    const element = await findElement(page, selector)
    
    if (!element) {
      throw new BrowserError('ELEMENT_NOT_FOUND', `Element not found: ${selector}`, { selector })
    }
    
    await element.fill('')
  },

  async getValue(selector: string): Promise<{ value: string }> {
    const state = browserStateData
    const page = await getPage(state)
    const element = await findElement(page, selector)
    
    if (!element) {
      throw new BrowserError('ELEMENT_NOT_FOUND', `Element not found: ${selector}`, { selector })
    }
    
    const value = await element.evaluate((el: HTMLInputElement) => el.value)
    return { value }
  },

  async back(): Promise<BrowserPageInfo> {
    const state = browserStateData
    const page = await getPage(state)
    
    await page.goBack()
    state.lastActivity = Date.now()
    
    return {
      id: (page as any).guid,
      url: page.url(),
      title: await page.title(),
    }
  },

  async forward(): Promise<BrowserPageInfo> {
    const state = browserStateData
    const page = await getPage(state)
    
    await page.goForward()
    state.lastActivity = Date.now()
    
    return {
      id: (page as any).guid,
      url: page.url(),
      title: await page.title(),
    }
  },

  async refresh(bypassCache: boolean = false): Promise<BrowserPageInfo> {
    const state = browserStateData
    const page = await getPage(state)
    
    await page.reload({ bypassCache } as any)
    state.lastActivity = Date.now()
    
    return {
      id: (page as any).guid,
      url: page.url(),
      title: await page.title(),
    }
  },

  async waitForElement(selector: string, state: 'attached' | 'detached' | 'visible' | 'hidden' = 'attached', timeout: number = 30000): Promise<{ found: boolean }> {
    const cfg = { ...DEFAULT_CONFIG, elementTimeoutMs: timeout }
    const stateObj = browserStateData
    const page = await getPage(stateObj)
    
    try {
      await page.waitForSelector(selector, { state, timeout: cfg.elementTimeoutMs })
      return { found: true }
    } catch {
      return { found: false }
    }
  },

  async waitForURL(pattern: string, timeout: number = 30000): Promise<{ found: boolean; url: string; currentUrl: string }> {
    const state = browserStateData
    const page = await getPage(state)
    
    const startTime = Date.now()
    const currentUrl = page.url()
    
    if (currentUrl.includes(pattern)) {
      return { found: true, url: currentUrl, currentUrl }
    }
    
    while (Date.now() - startTime < timeout) {
      await new Promise(r => setTimeout(r, 100))
      const url = page.url()
      if (url.includes(pattern)) {
        return { found: true, url, currentUrl }
      }
    }
    
    return { found: false, url: '', currentUrl: page.url() }
  },

  async getText(selector: string): Promise<{ text: string }> {
    const state = browserStateData
    const page = await getPage(state)
    const element = await findElement(page, selector)
    
    if (!element) {
      throw new BrowserError('ELEMENT_NOT_FOUND', `Element not found: ${selector}`, { selector })
    }
    
    const text = await element.textContent()
    return { text: text || '' }
  },

  async getAttribute(selector: string, attribute: string): Promise<{ value: string | null }> {
    const state = browserStateData
    const page = await getPage(state)
    const element = await findElement(page, selector)
    
    if (!element) {
      throw new BrowserError('ELEMENT_NOT_FOUND', `Element not found: ${selector}`, { selector })
    }
    
    const value = await element.getAttribute(attribute)
    return { value }
  },

  async getCSS(selector: string, property: string): Promise<{ value: string }> {
    const state = browserStateData
    const page = await getPage(state)
    const element = await findElement(page, selector)
    
    if (!element) {
      throw new BrowserError('ELEMENT_NOT_FOUND', `Element not found: ${selector}`, { selector })
    }
    
    const value = await element.evaluate((el: Element, prop: string) => {
      return window.getComputedStyle(el).getPropertyValue(prop)
    }, property)
    
    return { value }
  },

  async getPageSource(trimmed: boolean = true): Promise<{ source: string }> {
    const state = browserStateData
    const page = await getPage(state)
    let source = await page.content()
    
    if (trimmed) {
      source = source.trim()
    }
    
    return { source }
  },

  async getCookies(domain?: string): Promise<{ cookies: Array<{ name: string; value: string; domain: string; path: string; secure: boolean; httpOnly: boolean; sameSite: string }> }> {
    const state = browserStateData
    await getBrowser()
    
    const allCookies = await state.context?.cookies() || []
    const cookies = domain 
      ? allCookies.filter(c => c.domain.includes(domain))
      : allCookies
    
    return { cookies }
  },

  async setCookie(params: { name: string; value: string; domain: string; path?: string; secure?: boolean; httpOnly?: boolean; sameSite?: string }): Promise<void> {
    const state = browserStateData
    await getBrowser()
    
    await state.context?.addCookies([{
      name: params.name,
      value: params.value,
      domain: params.domain,
      path: params.path || '/',
      secure: params.secure || false,
      httpOnly: params.httpOnly || false,
      sameSite: params.sameSite as any || 'Lax',
    }])
  },

  async deleteCookie(name: string, domain?: string): Promise<void> {
    const state = browserStateData
    await getBrowser()
    
    const cookies = await state.context?.cookies() || []
    const toDelete = domain 
      ? cookies.filter(c => c.name === name && c.domain.includes(domain))
      : cookies.filter(c => c.name === name)
    
    for (const cookie of toDelete) {
      await state.context?.clearCookies(cookie)
    }
  },

  async getLocalStorage(key?: string): Promise<{ value: string | null; all: Record<string, string> }> {
    const state = browserStateData
    const page = await getPage(state)
    
    if (key) {
      const value = await page.evaluate((k: string) => localStorage.getItem(k), key)
      return { value, all: {} }
    } else {
      const all = await page.evaluate(() => {
        const obj: Record<string, string> = {}
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i)!
          obj[k] = localStorage.getItem(k)!
        }
        return obj
      })
      return { value: null, all }
    }
  },

  async setLocalStorage(key: string, value: string): Promise<void> {
    const state = browserStateData
    const page = await getPage(state)
    
    await page.evaluate((params: { k: string; v: string }) => {
      localStorage.setItem(params.k, params.v)
    }, { k: key, v: value })
  },

  async clearStorage(type: 'localStorage' | 'sessionStorage' | 'all' = 'all'): Promise<void> {
    const state = browserStateData
    const page = await getPage(state)
    
    if (type === 'all' || type === 'localStorage') {
      await page.evaluate(() => localStorage.clear())
    }
    if (type === 'all' || type === 'sessionStorage') {
      await page.evaluate(() => sessionStorage.clear())
    }
  },

  async setViewport(width: number, height: number): Promise<void> {
    const state = browserStateData
    await getBrowser()
    
    await state.context?.close()
    state.context = await state.browser!.newContext({
      viewport: { width, height },
      ignoreHTTPSErrors: true,
      locale: 'en-US',
    })
  },

  async setUserAgent(userAgent: string): Promise<void> {
    const state = browserStateData
    await getBrowser()
    
    await state.context?.close()
    state.context = await state.browser!.newContext({
      userAgent,
      ignoreHTTPSErrors: true,
      locale: 'en-US',
    })
  },

  async setGeolocation(latitude: number, longitude: number, accuracy: number = 100): Promise<void> {
    const state = browserStateData
    await getBrowser()
    
    await state.context?.close()
    state.context = await state.browser!.newContext({
      geolocation: { latitude, longitude, accuracy },
      ignoreHTTPSErrors: true,
      locale: 'en-US',
    })
  },

  async setTimezone(timezone: string): Promise<void> {
    const state = browserStateData
    await getBrowser()
    
    await state.context?.close()
    state.context = await state.browser!.newContext({
      timezoneId: timezone,
      ignoreHTTPSErrors: true,
      locale: 'en-US',
    })
  },

  async assertText(selector: string, expected: string, contains: boolean = false): Promise<{ passed: boolean; actual: string }> {
    const { text } = await this.getText(selector)
    const passed = contains ? text.includes(expected) : text === expected
    return { passed, actual: text }
  },

  async assertVisible(selector: string, visible: boolean = true): Promise<{ passed: boolean }> {
    const state = browserStateData
    const page = await getPage(state)
    const element = await findElement(page, selector)
    
    if (!element) {
      return { passed: !visible }
    }
    
    const isVisible = await element.isVisible()
    return { passed: isVisible === visible }
  },

  async assertURL(pattern: string): Promise<{ passed: boolean; url: string; currentUrl: string }> {
    const state = browserStateData
    const page = await getPage(state)
    const url = page.url()
    const passed = url.includes(pattern)
    return { passed, url, currentUrl: url }
  },

  async reset(): Promise<void> {
    await closeBrowser(browserStateData)
    browserStateData = {
      browser: null,
      context: null,
      lastActivity: Date.now(),
      pageCount: 0,
    }
  },
}

async function findElement(
  page: Page,
  selector: string,
  config: Partial<BrowserConfig> = {}
): Promise<ElementHandle | null> {
  const cfg = { ...DEFAULT_CONFIG, ...config }
  
  for (const strategy of getSelectorStrategies(selector)) {
    try {
      const element = await page.waitForSelector(strategy, {
        state: 'attached',
        timeout: cfg.elementTimeoutMs,
      })
      if (element) {
        return element
      }
    } catch {
      continue
    }
  }
  
  return null
}

export function getSelectorStrategies(input: string): string[] {
  if (input.startsWith('text=')) {
    const text = input.slice(5).replace(/"/g, '').replace(/'/g, "\\'")
    return [
      `xpath=//*[text()="${text}"]`,
      `xpath=//*[contains(text(), "${text}")]`,
      `text="${text}"`,
    ]
  }
  
  if (input.startsWith('[data-testid=') || input.startsWith('[aria-label=')) {
    return [input]
  }
  
  if (input.startsWith('.') || input.startsWith('#') || input.startsWith('[')) {
    return [input]
  }
  
  if (input.includes('/') || input.startsWith('//')) {
    return [input]
  }
  
  return [
    `text="${input}"`,
    input,
    `xpath=//*[contains(@*, "${input}")]`,
    `xpath=//*[text()="${input}"]`,
  ]
}
