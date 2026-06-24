import type { APIEvent } from "@solidjs/start/server"
import { Referral } from "@opencode-ai/console-core/referral.js"
import { safeEqual } from "@opencode-ai/console-core/util/crypto.js"
import { Resource } from "@opencode-ai/console-resource"
import z from "zod"

const Body = z.object({
  inviterWorkspaceID: z.string().startsWith("wrk_"),
  inviteeWorkspaceID: z.string().startsWith("wrk_"),
})

export async function POST(event: APIEvent) {
  if (!safeEqual(event.request.headers.get("authorization") ?? "", `Bearer ${Resource.SUPPORT_API_KEY.value}`)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = Body.safeParse(await event.request.json().catch(() => undefined))
  if (!body.success) {
    return Response.json({ error: "Invalid request", issues: body.error.issues }, { status: 400 })
  }
  return Referral.create(body.data)
    .then((result) => Response.json({ success: true, message: "Referral created", result }))
    .catch((error) =>
      Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 }),
    )
}
