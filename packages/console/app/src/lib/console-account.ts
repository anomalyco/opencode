import { Resource } from "@opencode/console-resource"
import { z } from "zod"

export const consoleAccountSchema = z.object({
  id: z.string().min(1).max(255),
  email: z.email(),
  name: z.string().nullable(),
  createdAt: z.iso.datetime(),
})
export type ConsoleAccount = z.infer<typeof consoleAccountSchema>

export async function lookupConsoleAccount(email: string): Promise<ConsoleAccount | null> {
  const response = await fetch(`${Resource.CONSOLE_CRM_LOOKUP_URL.value}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${Resource.CONSOLE_CRM_TOKEN.value}` },
    body: JSON.stringify({ email }),
    signal: AbortSignal.timeout(8000),
  })
  if (!response.ok) throw new Error(`Console account lookup failed (${response.status})`)
  const result = z.object({ account: consoleAccountSchema.nullable() }).parse(await response.json())
  return result.account
}

export function consoleAccountFields(account: ConsoleAccount | null) {
  if (!account) return { Has_Console_Account__c: false }
  return {
    Has_Console_Account__c: true,
    Console_Account_ID__c: account.id,
    Console_Signup_Date__c: account.createdAt,
  }
}
