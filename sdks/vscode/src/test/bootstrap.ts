import { initRunDir, captureFailure } from './helpers/evidence'

// attempt to attach Playwright to the VS Code renderer so page.screenshot() is available
async function attachPlaywrightToVSCode() {
  const port = process.env.PW_VSCODE_DEBUG_PORT || '9222'
  let chromium: any
  try { chromium = require('playwright').chromium } catch (e) { /* ignore */ }
  try { if (!chromium) chromium = require('@playwright/test').chromium } catch (e) { /* ignore */ }
  if (!chromium) return

  const endpointBase = `http://127.0.0.1:${port}`
  let browser: any = null
  // Retry loop to wait for DevTools to become available
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      // first try HTTP base (Playwright accepts http://host:port)
      browser = await chromium.connectOverCDP(endpointBase)
    } catch (e) {
      try {
        const http = require('http')
        const url = `${endpointBase}/json/version`
        const body = await new Promise<string>((resolve, reject) => {
          const req = http.get(url, (res: any) => {
            let s = ''
            res.on('data', (d: any) => s += d)
            res.on('end', () => resolve(s))
          })
          req.on('error', reject)
        })
        const info = JSON.parse(body || '{}')
        const ws = info.webSocketDebuggerUrl || info.webSocketUrl
        if (ws) {
          try { browser = await chromium.connectOverCDP(ws) } catch (e) { browser = null }
        }
      } catch (e) {
        browser = null
      }
    }

    if (browser) break
    // wait before retry
    await new Promise((r) => setTimeout(r, 500))
  }

  if (!browser) return

  try {
    // prefer first page from any existing context
    let page: any
    const contexts = typeof browser.contexts === 'function' ? browser.contexts() : (browser.contexts || [])
    for (const ctx of contexts) {
      try {
        const pages = typeof ctx.pages === 'function' ? ctx.pages() : (ctx.pages || [])
        if (pages && pages.length) { page = pages[0]; break }
      } catch (e) {}
    }
    if (!page && typeof browser.pages === 'function') {
      const pages = await (browser as any).pages()
      if (pages && pages.length) page = pages[0]
    }
    if (!page) {
      try {
        const ctx = await browser.newContext()
        page = await ctx.newPage()
      } catch (e) {}
    }
    if (page) {
      (global as any).page = page
      try { console.log('Playwright attached to VS Code renderer') } catch (e) {}
    }
  } catch (e) {
    // ignore
  }
}

const _playwrightAttachPromise = attachPlaywrightToVSCode()

const runDirPromise = initRunDir()

const logs: string[] = []
const origLog = console.log.bind(console)
console.log = (...args: any[]) => {
  try { logs.push(args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')) } catch(e) {}
  origLog(...args)
}
const origError = console.error.bind(console)
console.error = (...args: any[]) => {
  try { logs.push('ERROR: ' + args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')) } catch(e) {}
  origError(...args)
}

;(global as any).__EXT_LOGS__ = logs

export const mochaHooks = {
  async afterEach(this: any) {
    const t: any = this && this.currentTest
    if (!t) return
    // capture evidence for every test (pass or fail) so artifacts are always available
    const runDir = await runDirPromise
    try {
      await captureFailure(t, t.err, runDir)
    } catch (e) {
      // do not mask test outcome
    }
  }
}

export {}
