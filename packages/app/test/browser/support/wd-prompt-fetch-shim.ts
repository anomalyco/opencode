import type { BrowserContext, Page } from "playwright"

const hooked = new WeakSet<BrowserContext>()

const SHIM = `(function(){
  if (window.__e2ePromptFetchShim) return
  window.__e2ePromptFetchShim = true
  var orig = window.fetch.bind(window)
  window.fetch = function (input, init) {
    var cfgRaw = sessionStorage.getItem("__e2e_prompt_fetch")
    if (!cfgRaw) return orig(input, init)
    var cfg = {}
    try { cfg = JSON.parse(cfgRaw) } catch (e) {}
    var urlStr = typeof input === "string" ? input : input.url
    var u = new URL(urlStr, window.location.href)
    var path = u.pathname
    var method = init && init.method ? String(init.method).toUpperCase() : "GET"
    if (cfg.abortSyncMessage === true && method === "POST" && /\\/session\\/[^/]+\\/message(?:\\/|$)/.test(path)) {
      return Promise.reject(new TypeError("Failed to fetch"))
    }
    if (cfg.promptAsync500 && method === "POST" && path.indexOf("/session/" + cfg.promptAsync500 + "/prompt_async") !== -1) {
      return Promise.resolve(new Response(JSON.stringify({ message: "e2e prompt failure" }), { status: 500, headers: { "Content-Type": "application/json" } }))
    }
    return orig(input, init)
  }
})()`

export async function ensureWdPromptFetchShim(ctx: BrowserContext) {
  if (hooked.has(ctx)) return
  await ctx.addInitScript({ content: SHIM })
  hooked.add(ctx)
}

export async function prepareWdPromptFetchAbort(page: Page) {
  await page.evaluate(() => sessionStorage.setItem("__e2e_prompt_fetch", JSON.stringify({ abortSyncMessage: true })))
}

export async function prepareWdPromptFetchAsync500(page: Page, sessionId: string) {
  await page.evaluate(
    (id: string) => sessionStorage.setItem("__e2e_prompt_fetch", JSON.stringify({ promptAsync500: id })),
    sessionId,
  )
}

export async function clearWdPromptFetch(page: Page) {
  await page.evaluate(() => sessionStorage.removeItem("__e2e_prompt_fetch"))
}
