import { createMiddleware } from "@solidjs/start/middleware"
import { LOCALE_HEADER, cookie, fromPathname, strip } from "~/lib/language"

export default createMiddleware({
  onRequest(event) {
    const url = new URL(event.request.url)
    const locale = fromPathname(url.pathname)
    if (!locale) return

    event.request.headers.set(LOCALE_HEADER, locale)
    event.response.headers.append("set-cookie", cookie(locale))

    url.pathname = strip(url.pathname)
    event.request = new Request(url, event.request)
  },
})
