import { createMiddleware } from "@solidjs/start/middleware"
import { LOCALE_HEADER, cookie, fromPathname, strip } from "~/lib/language"
import { sanitizeServerActionRequest } from "~/lib/server-action"

export default createMiddleware({
  async onRequest(event) {
    event.request = sanitizeServerActionRequest(event.request)

    const url = new URL(event.request.url)
    const locale = fromPathname(url.pathname)
    if (locale) {
      url.pathname = strip(url.pathname)
      if (/^\/changelog\/?$/.test(url.pathname))
        return new Response(null, { status: 301, headers: { Location: "/changelog" } })
      // English pages live at unprefixed URLs, so /en/... would be a duplicate of every page.
      // /data keeps /en because it redirects unprefixed visits by cookie and Accept-Language.
      // Collapse leading slashes so /en//example.com can't become a protocol-relative redirect.
      if (
        locale === "en" &&
        (event.request.method === "GET" || event.request.method === "HEAD") &&
        !/^\/data(\/|$)/.test(url.pathname)
      )
        return new Response(null, {
          status: 301,
          headers: { Location: `${url.pathname.replace(/^\/+/, "/")}${url.search}` },
        })
      const request = new Request(url, event.request)
      request.headers.set(LOCALE_HEADER, locale)
      event.request = request
      event.response.headers.append("set-cookie", cookie(locale))
    }

    // Black subscriptions were migrated to Go.
    if (/^\/black(\/|$)/.test(url.pathname))
      return new Response(null, { status: 301, headers: { Location: locale ? `/${locale}/go` : "/go" } })

    // The legacy dashboard and its sign-in moved to the new Console.
    if (/^\/(auth|workspace)(\/|$)/.test(url.pathname))
      return new Response(null, {
        status: 302,
        headers: { Location: "https://opencode.ai/console/login", "Cache-Control": "no-store" },
      })
  },
})
