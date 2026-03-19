import type { APIEvent } from "@solidjs/start/server"
import { CompanyLicense } from "@opencode-ai/console-core/company-license.js"
import { Resource } from "@opencode-ai/console-resource"

export async function POST(event: APIEvent) {
  const auth = event.request.headers.get("authorization")
  if (auth !== `Bearer ${Resource.NUMERAL_INTERNAL_TOKEN.value}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 })
  }

  const result = await CompanyLicense.sync(await event.request.json())
  return Response.json(result)
}
