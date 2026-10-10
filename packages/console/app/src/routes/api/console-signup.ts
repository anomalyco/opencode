import { timingSafeEqual } from "node:crypto"
import type { APIEvent } from "@solidjs/start/server"
import { Resource } from "@opencode-ai/console-resource"
import { consoleAccountSchema } from "~/lib/console-account"
import { salesforceRequest, syncConsoleAccount, type SalesforceRequest } from "~/lib/salesforce"

export async function POST(event: APIEvent) {
  return handleConsoleSignup(event.request, Resource.CONSOLE_CRM_TOKEN.value)
}

export async function handleConsoleSignup(request: Request, token: string, salesforce?: SalesforceRequest) {
  const expected = Buffer.from(`Bearer ${token}`)
  const actual = Buffer.from(request.headers.get("authorization") ?? "")
  if (!token || expected.length !== actual.length || !timingSafeEqual(expected, actual))
    return new Response(null, { status: 401 })
  const data: unknown = await request.json().catch(() => null)
  const account = consoleAccountSchema.safeParse(data)
  if (!account.success) return Response.json({ error: "Invalid Console account" }, { status: 400 })
  return Promise.resolve(salesforce)
    .then(async (client) => syncConsoleAccount(account.data, client ?? (await salesforceRequest())))
    .then(
      (result) => Response.json(result),
      () => Response.json({ error: "Salesforce sync unavailable" }, { status: 503 }),
    )
}
