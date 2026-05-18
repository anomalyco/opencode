import type { BrowserContext, Page } from "playwright"

const hooked = new WeakSet<BrowserContext>()

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

export async function ensureWdPermissionFetchShim(ctx: BrowserContext) {
  if (hooked.has(ctx)) return
  await ctx.addInitScript({ content: SHIM })
  hooked.add(ctx)
}

export async function prepareWdPermissionMock(
  page: Page,
  input: { pending: Record<string, unknown>[]; child?: Record<string, unknown> },
) {
  await page.evaluate(
    (args: { pending: Record<string, unknown>[]; child: Record<string, unknown> | null }) => {
      sessionStorage.setItem("__e2e_perm_pending", JSON.stringify(args.pending))
      if (args.child) sessionStorage.setItem("__e2e_session_child", JSON.stringify(args.child))
      else sessionStorage.removeItem("__e2e_session_child")
    },
    { pending: input.pending, child: input.child ? input.child : null },
  )
}

export async function clearWdPermissionMock(page: Page) {
  await page.evaluate(() => {
    sessionStorage.removeItem("__e2e_perm_pending")
    sessionStorage.removeItem("__e2e_session_child")
  })
}
