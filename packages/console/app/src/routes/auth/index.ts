import { redirect } from "@solidjs/router"
import type { APIEvent } from "@solidjs/start/server"
import { getLastSeenWorkspaceID } from "../workspace/common"
import { localeFromRequest, route } from "~/lib/language"

export async function GET(input: APIEvent) {
  const locale = localeFromRequest(input.request)
  try {
    const workspaceID = await getLastSeenWorkspaceID()
    return redirect(route(locale, `/workspace/${workspaceID}`))
  } catch {
    return redirect("/auth/authorize")
  }
}
