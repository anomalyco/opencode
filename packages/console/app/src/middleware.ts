import { createMiddleware } from "@solidjs/start/middleware"
import { LOCALE_HEADER, cookie, fromPathname, strip } from "~/lib/language"

export default createMiddleware({
  onRequest(event) {
    const url = new URL(event.request.url)
    const locale = fromPathname(url.pathname)
    if (!locale) return

    url.pathname = strip(url.pathname)
    const request = new Request(url, event.request)
    request.headers.set(LOCALE_HEADER, locale)
    event.request = request
    event.response.headers.append("set-cookie", cookie(locale))
  },
})
