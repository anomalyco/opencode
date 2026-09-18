import { redirect } from "@solidjs/router"
import { Resource } from "@opencode-ai/console-resource"
import type { APIEvent } from "@solidjs/start/server"
import { getLastSeenWorkspaceID } from "../workspace/common"
import { localeFromRequest, route } from "~/lib/language"

export async function GET(input: APIEvent) {
  const locale = localeFromRequest(input.request)
  try {
    const workspaceID = await getLastSeenWorkspaceID()
    if (!workspaceID) {
      const destination = Resource.ConsoleMigration.consoleUrl
      if (!destination) throw new Error("New Console URL is not configured")
      return redirect(`${destination}/login`, { headers: { "Cache-Control": "no-store" } })
    }
    return redirect(route(locale, `/workspace/${workspaceID}`))
  } catch {
    return redirect("/auth/authorize")
  }
}
