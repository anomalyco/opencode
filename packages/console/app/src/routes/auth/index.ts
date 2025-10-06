import { Account } from "@opencode-ai/console-core/account.js"
import { redirect } from "@solidjs/router"
import type { APIEvent } from "@solidjs/start/server"
import { withActor } from "~/context/auth.withActor"

export async function GET(input: APIEvent) {
  try {
    const workspaces = await withActor(async () => Account.workspaces())
    return redirect(`/workspace/${workspaces[0].id}`)
  } catch {
    return redirect("/auth/authorize")
  }
}
