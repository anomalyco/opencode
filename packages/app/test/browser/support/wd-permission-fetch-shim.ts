import type { WebDriver } from "selenium-webdriver"

const hooked = new WeakSet<WebDriver>()

const SHIM = `(function(){
  if (window.__e2ePermFetchShim) return
  window.__e2ePermFetchShim = true
  var orig = window.fetch.bind(window)
  window.fetch = function (input, init) {
    var urlStr = typeof input === "string" ? input : input.url
    var u = new URL(urlStr, window.location.href)
    var method = init && init.method ? String(init.method).toUpperCase() : "GET"
    var permKey = "__e2e_perm_pending"
    var childKey = "__e2e_session_child"
    function readPending() {
      try {
        var raw = sessionStorage.getItem(permKey)
        return raw ? JSON.parse(raw) : []
      } catch (e) {
        return []
      }
    }
    function writePending(p) {
      sessionStorage.setItem(permKey, JSON.stringify(p))
    }
    if (method === "GET" && /\\/permission$/.test(u.pathname)) {
      var pending = readPending()
      return Promise.resolve(new Response(JSON.stringify(pending), { status: 200, headers: { "Content-Type": "application/json" } }))
    }
    var replyMatch = u.pathname.match(/\\/session\\/[^/]+\\/permissions\\/([^/]+)$/)
    if (replyMatch && (method === "POST" || method === "PUT" || method === "PATCH")) {
      var rid = replyMatch[1]
      var pr = readPending()
      writePending(pr.filter(function (item) { return item.id !== rid }))
      return Promise.resolve(new Response(JSON.stringify(true), { status: 200, headers: { "Content-Type": "application/json" } }))
    }
    if (method === "GET" && /\\/session$/.test(u.pathname) && u.search && sessionStorage.getItem(childKey)) {
      var rawChild = sessionStorage.getItem(childKey)
      var child = null
      try {
        child = rawChild ? JSON.parse(rawChild) : null
      } catch (e) {
        child = null
      }
      return orig(input, init).then(function (res) {
        var ct = res.headers.get("content-type") || ""
        if (!ct.includes("json")) return res
        return res.clone().text().then(function (text) {
          var json
          try {
            json = JSON.parse(text)
          } catch (e) {
            return res
          }
          var list = Array.isArray(json) ? json : json && Array.isArray(json.data) ? json.data : null
          if (Array.isArray(list) && child && !list.some(function (item) { return item && item.id === child.id })) {
            list.push(child)
            var body
            if (Array.isArray(json)) body = JSON.stringify(list)
            else {
              var next = Object.assign({}, json, { data: list })
              body = JSON.stringify(next)
            }
            return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers })
          }
          return res
        })
      })
    }
    return orig(input, init)
  }
})()`

type Cdp = { executeCdpCommand(cmd: string, params: Record<string, unknown>): Promise<unknown> }

/** Registers a one-per-driver `Page.addScriptToEvaluateOnNewDocument` hook (Chrome). */
export async function ensureWdPermissionFetchShim(driver: WebDriver) {
  if (hooked.has(driver)) return
  const cdp = driver as unknown as Cdp
  if (typeof cdp.executeCdpCommand !== "function") {
    throw new Error("executeCdpCommand missing — permission mock needs Chromium WebDriver")
  }
  await cdp.executeCdpCommand("Page.addScriptToEvaluateOnNewDocument", { source: SHIM })
  hooked.add(driver)
}

export async function prepareWdPermissionMock(
  driver: WebDriver,
  input: { pending: Record<string, unknown>[]; child?: Record<string, unknown> },
) {
  await driver.executeScript(
    `sessionStorage.setItem("__e2e_perm_pending", JSON.stringify(arguments[0]));
     if (arguments[1]) sessionStorage.setItem("__e2e_session_child", JSON.stringify(arguments[1]));
     else sessionStorage.removeItem("__e2e_session_child");`,
    input.pending,
    input.child ? input.child : null,
  )
}

export async function clearWdPermissionMock(driver: WebDriver) {
  await driver.executeScript(`sessionStorage.removeItem("__e2e_perm_pending"); sessionStorage.removeItem("__e2e_session_child");`)
}
