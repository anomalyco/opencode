import { Resource } from "@opencode/console-resource"
import { z } from "zod"
import { consoleAccountFields, type ConsoleAccount } from "./console-account"

// Match provider domains exactly; business domains hosted by these providers remain business addresses.
const personalEmailDomains = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "outlook.co.uk",
  "hotmail.com",
  "hotmail.co.uk",
  "hotmail.fr",
  "hotmail.de",
  "hotmail.it",
  "live.com",
  "live.co.uk",
  "live.ca",
  "live.com.au",
  "msn.com",
  "yahoo.com",
  "yahoo.co.uk",
  "yahoo.co.in",
  "yahoo.com.au",
  "yahoo.ca",
  "yahoo.fr",
  "yahoo.de",
  "yahoo.it",
  "yahoo.co.jp",
  "ymail.com",
  "rocketmail.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "proton.me",
  "protonmail.com",
  "pm.me",
  "aol.com",
  "aim.com",
  "gmx.com",
  "gmx.de",
  "gmx.net",
  "mail.com",
  "fastmail.com",
  "fastmail.fm",
  "hey.com",
  "tuta.com",
  "tuta.io",
  "tutanota.com",
  "tutanota.de",
])

async function login() {
  const url = Resource.SALESFORCE_INSTANCE_URL.value.replace(/\/$/, "")
  const clientId = Resource.SALESFORCE_CLIENT_ID.value
  const clientSecret = Resource.SALESFORCE_CLIENT_SECRET.value

  const params = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
  })

  const res = await fetch(`${url}/services/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  }).catch((err) => {
    console.error("Failed to fetch Salesforce access token:", err)
  })

  if (!res) return

  if (!res.ok) {
    console.error("Failed to fetch Salesforce access token:", res.status, await res.text())
    return
  }

  const data = (await res.json()) as { access_token?: string; instance_url?: string }
  if (!data.access_token) {
    console.error("Salesforce auth response did not include an access token")
    return
  }

  return {
    token: data.access_token,
    url: data.instance_url ?? url,
  }
}

export interface SalesforceLeadInput {
  name: string
  role: string
  company?: string
  email: string
  phone?: string
  inferenceSpend?: string
  leadSource?: "enterprise website form"
  message: string
  consoleAccount?: ConsoleAccount | null
}

export async function createLead(
  input: SalesforceLeadInput,
  submit?: (payload: Record<string, unknown>) => Promise<boolean>,
): Promise<boolean> {
  const payload = {
    LastName: input.name,
    Company: input.company?.trim() || "Website",
    Email: input.email,
    Phone: input.phone ?? null,
    Title: input.role,
    Description: input.message,
    Current_Monthly_Inference_Spend__c: input.inferenceSpend,
    LeadSource: input.leadSource ?? "Website",
    ...(input.consoleAccount === undefined ? {} : consoleAccountFields(input.consoleAccount)),
  }
  if (submit) return submit(payload)
  const auth = await login()
  if (!auth) return false

  const res = await fetch(`${auth.url}/services/data/v59.0/sobjects/Lead`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${auth.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  }).catch((err) => {
    console.error("Failed to create Salesforce lead:", err)
  })

  if (!res) return false

  if (!res.ok) {
    console.error("Failed to create Salesforce lead:", res.status, await res.text())
    return false
  }

  return true
}

export type SalesforceRequest = (
  path: string,
  method?: "GET" | "POST" | "PATCH",
  payload?: Record<string, unknown>,
) => Promise<unknown>

export async function salesforceRequest(): Promise<SalesforceRequest> {
  const auth = await login()
  if (!auth) throw new Error("Salesforce authentication unavailable")
  return async (path, method = "GET", payload) => {
    const response = await fetch(`${auth.url}${path}`, {
      method,
      headers: { Authorization: `Bearer ${auth.token}`, "Content-Type": "application/json" },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
      signal: AbortSignal.timeout(8000),
    })
    if (!response.ok) throw new Error(`Salesforce request failed (${response.status})`)
    if (response.status === 204) return null
    return response.json()
  }
}

/** Update existing people without changing their acquisition source or sales notes. */
export async function syncConsoleAccount(account: ConsoleAccount, request: SalesforceRequest) {
  const quote = (value: string) => value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")
  const matches = async (object: "Contact" | "Lead") => {
    const query = `SELECT Id FROM ${object} WHERE ${object === "Lead" ? "IsConverted = false AND " : ""}(Console_Account_ID__c = '${quote(account.id)}' OR Email = '${quote(account.email.toLowerCase())}')`
    const records: { Id: string }[] = []
    let path: string | undefined = `/services/data/v59.0/query?q=${encodeURIComponent(query)}`
    while (path) {
      const result = z
        .object({
          records: z.array(z.object({ Id: z.string().regex(/^[a-zA-Z0-9]{15,18}$/) })),
          done: z.boolean(),
          nextRecordsUrl: z.string().optional(),
        })
        .parse(await request(path))
      records.push(...result.records)
      if (result.done) break
      if (!result.nextRecordsUrl?.startsWith("/services/data/")) throw new Error("Salesforce query pagination missing")
      path = result.nextRecordsUrl
    }
    return records.map((record) => ({ object, id: record.Id }))
  }
  const people = [...(await matches("Contact")), ...(await matches("Lead"))]
  const fields = consoleAccountFields(account)
  for (const person of people)
    await request(`/services/data/v59.0/sobjects/${person.object}/${person.id}`, "PATCH", fields)
  if (people.length > 0) return { success: true, created: false, updated: people.length }
  const domain = account.email.slice(account.email.lastIndexOf("@") + 1).toLowerCase()
  const result = z.object({ success: z.literal(true), id: z.string() }).parse(
    await request("/services/data/v59.0/sobjects/Lead", "POST", {
      LastName: (account.name?.trim() || account.email).slice(0, 80),
      Company: personalEmailDomains.has(domain) ? "Individual" : domain,
      Email: account.email.toLowerCase(),
      LeadSource: "console signup",
      ...fields,
    }),
  )
  return { success: true, created: true, id: result.id }
}
