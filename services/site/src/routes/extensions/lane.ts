import type { APIEvent } from "@solidjs/start/server"
import { redirect } from "@solidjs/router"
import { localeFromRequest, route } from "~/lib/language"

// Lane is no longer listed; its old page goes to the Extensions on /product.
export async function GET(event: APIEvent) {
  return redirect(`${route(localeFromRequest(event.request), "/product")}#extensions`, 301)
}
