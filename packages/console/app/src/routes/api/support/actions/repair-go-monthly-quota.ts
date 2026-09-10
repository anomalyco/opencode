import type { APIEvent } from "@solidjs/start/server"
import { GoQuotaRepair } from "@opencode-ai/console-core/go-quota-repair.js"
import { safeEqual } from "@opencode-ai/console-core/util/crypto.js"
import { Resource } from "@opencode-ai/console-resource"

export async function POST(event: APIEvent) {
  if (!safeEqual(event.request.headers.get("authorization") ?? "", `Bearer ${Resource.SUPPORT_API_KEY.value}`)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }
  const body = GoQuotaRepair.Input.safeParse(await event.request.json().catch(() => undefined))
  if (!body.success) {
    return Response.json({ error: "Invalid request", issues: body.error.issues }, { status: 400 })
  }
  return GoQuotaRepair.repair(body.data)
    .then((receipt) => Response.json(receipt))
    .catch((error: unknown) => {
      if (error instanceof GoQuotaRepair.Conflict) return Response.json({ error: error.message }, { status: 409 })
      return Response.json({ error: "Monthly quota repair failed" }, { status: 500 })
    })
}
