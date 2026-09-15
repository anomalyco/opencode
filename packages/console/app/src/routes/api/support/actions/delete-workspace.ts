import type { APIEvent } from "@solidjs/start/server"
import { Workspace } from "@opencode/console-core/workspace.js"
import { safeEqual } from "@opencode/console-core/util/crypto.js"
import { Resource } from "@opencode/console-resource"

export async function DELETE(event: APIEvent) {
  if (!safeEqual(event.request.headers.get("authorization") ?? "", `Bearer ${Resource.SUPPORT_API_KEY.value}`)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = Workspace.removeExact.schema.safeParse(await event.request.json().catch(() => undefined))
  if (!body.success) {
    return Response.json({ error: "Invalid request", issues: body.error.issues }, { status: 400 })
  }
  return Workspace.removeExact
    .force(body.data)
    .then(() => Response.json({ success: true, message: "Workspace deleted" }))
    .catch((error) => Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 }))
}
