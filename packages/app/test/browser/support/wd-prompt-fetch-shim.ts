import type { WebDriver } from "selenium-webdriver"

const hooked = new WeakSet<WebDriver>()

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

type Cdp = { executeCdpCommand(cmd: string, params: Record<string, unknown>): Promise<unknown> }

export async function ensureWdPromptFetchShim(driver: WebDriver) {
  if (hooked.has(driver)) return
  const cdp = driver as unknown as Cdp
  if (typeof cdp.executeCdpCommand !== "function") {
    throw new Error("executeCdpCommand missing — prompt fetch mock needs Chromium WebDriver")
  }
  await cdp.executeCdpCommand("Page.addScriptToEvaluateOnNewDocument", { source: SHIM })
  hooked.add(driver)
}

export async function prepareWdPromptFetchAbort(driver: WebDriver) {
  await driver.executeScript(`sessionStorage.setItem("__e2e_prompt_fetch", JSON.stringify({ abortSyncMessage: true }))`)
}

export async function prepareWdPromptFetchAsync500(driver: WebDriver, sessionId: string) {
  await driver.executeScript(
    `sessionStorage.setItem("__e2e_prompt_fetch", JSON.stringify({ promptAsync500: arguments[0] }))`,
    sessionId,
  )
}

export async function clearWdPromptFetch(driver: WebDriver) {
  await driver.executeScript(`sessionStorage.removeItem("__e2e_prompt_fetch")`)
}
