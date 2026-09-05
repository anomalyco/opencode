import type { APIEvent } from "@solidjs/start/server"
import { Workspace } from "@opencode-ai/console-core/workspace.js"
import { safeEqual } from "@opencode-ai/console-core/util/crypto.js"
import { Resource } from "@opencode-ai/console-resource"
import z from "zod"

const Body = z.object({
  workspaceID: z.string().startsWith("wrk_"),
  requesterEmail: z.email(),
})

export async function DELETE(event: APIEvent) {
  if (!safeEqual(event.request.headers.get("authorization") ?? "", `Bearer ${Resource.SUPPORT_API_KEY.value}`)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = Body.safeParse(await event.request.json().catch(() => undefined))
  if (!body.success) {
    return Response.json({ error: "Invalid request", issues: body.error.issues }, { status: 400 })
  }
  return Workspace.removeExact({
    workspaceID: body.data.workspaceID,
    expectedRequesterEmail: body.data.requesterEmail,
  })
    .then(() => Response.json({ success: true, message: "Workspace deleted" }))
    .catch((error) => {
      if (error instanceof Workspace.RemovalRejected) {
        return Response.json({ error: error.message }, { status: 400 })
      }
      return Response.json({ error: "Workspace deletion outcome is unknown" }, { status: 500 })
    })
}
