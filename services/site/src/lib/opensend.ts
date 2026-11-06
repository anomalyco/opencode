import { z } from "zod"

// The newsletter lives in OpenSend (https://opensend.anoma.ly), on the "OpenCode - Newsletter
// MASTER" list. Server-only: the key is OPENSEND_API_KEY, a secret on the site Worker.
const api = "https://opensend.anoma.ly"
export const newsletterList = "lst_83ab8cf3264d40e1b6b01fe5c2bd94bb"

export type SignupStatus = "subscribed" | "already" | "invalid" | "error"

export type Signup = {
  key: string
  email: string
  /** The page the form was sent from, recorded as consent evidence. */
  page: string
  at: Date
  fetch?: (url: string, init: RequestInit) => Promise<Response>
}

const contact = z.object({
  id: z.string(),
  marketingConsent: z.enum(["unknown", "subscribed", "unsubscribed"]),
  suppressed: z.boolean(),
  suppressionReason: z.string().nullable(),
  // Only reads include memberships; a contact just created has none.
  listIds: z.array(z.string()).default([]),
})
const page = z.object({ data: z.array(contact) })
const failure = z.object({
  error: z.object({ code: z.string(), field: z.string().optional(), requestId: z.string().optional() }),
})

type Contact = z.infer<typeof contact>
type Reply = { status: number; body: unknown }
type Call = (method: string, path: string, body?: unknown) => Promise<Reply>

/**
 * Subscribes an address from a sign-up form: finds or creates its contact, records the form as
 * consent evidence and adds it to the newsletter list. Each write runs only when it's still
 * needed, so a retried submission changes nothing that already happened. (OpenSend's contact,
 * consent and list routes ignore Idempotency-Key; only sends honour it.)
 *
 * An address that unsubscribed or is suppressed (bounced, complained) is left alone: OpenSend
 * replaces an opt-out only on renewed, verifiable consent, which an unconfirmed form isn't, and
 * consent never lifts suppression.
 */
export async function subscribe(input: Signup): Promise<SignupStatus> {
  const call = caller(input)
  const found = await contactFor(call, input.email)
  if (typeof found === "string") return found
  if (found.suppressed || found.marketingConsent === "unsubscribed") {
    console.warn("OpenSend sign-up skipped:", found.id, found.suppressed ? found.suppressionReason : "unsubscribed")
    return "error"
  }
  const subscribed = found.marketingConsent === "subscribed"
  const listed = found.listIds.includes(newsletterList)
  if (!subscribed) {
    const consent = await call("POST", `/v1/contacts/${encodeURIComponent(found.id)}/consent`, {
      status: "subscribed",
      source: "opencode.ai sign-up form",
      evidence: `Submitted the newsletter sign-up form on ${input.page}`,
      occurredAt: input.at.toISOString(),
    })
    if (consent.status !== 200) return failed("record consent", consent)
  }
  if (!listed) {
    const added = await call("POST", `/v1/lists/${newsletterList}/members`, { contactIds: [found.id] })
    if (added.status !== 200) return failed("add the contact to the list", added)
  }
  return subscribed && listed ? "already" : "subscribed"
}

async function contactFor(call: Call, email: string): Promise<Contact | "invalid" | "error"> {
  const existing = await lookup(call, email)
  if (existing !== undefined) return existing
  const created = await call("POST", "/v1/contacts", { email })
  if (created.status === 201) return contact.parse(created.body)
  if (rejectsEmail(created)) return "invalid"
  if (code(created) !== "CONTACT_EXISTS") return failed("create the contact", created)
  // Created since the lookup, or deleted: OpenSend keeps a deleted address's consent and
  // suppression, and only an import restores it.
  return (await lookup(call, email)) ?? failed("restore a deleted contact", created)
}

async function lookup(call: Call, email: string) {
  const reply = await call("GET", `/v1/contacts?${new URLSearchParams({ email, limit: "1" })}`)
  if (rejectsEmail(reply)) return "invalid"
  if (reply.status !== 200) return failed("look up the contact", reply)
  return page.parse(reply.body).data[0]
}

function caller(input: Signup): Call {
  const request = input.fetch ?? fetch
  return async (method, path, body) => {
    const response = await request(`${api}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${input.key}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => undefined)
    if (!response) return { status: 0, body: undefined }
    return { status: response.status, body: await response.json().catch(() => undefined) }
  }
}

// OpenSend's own email check is stricter than the form's.
function rejectsEmail(reply: Reply) {
  return reply.status >= 400 && reply.status < 500 && failure.safeParse(reply.body).data?.error.field === "email"
}

function code(reply: Reply) {
  return failure.safeParse(reply.body).data?.error.code
}

function failed(step: string, reply: Reply) {
  const error = failure.safeParse(reply.body).data?.error
  console.error(`OpenSend sign-up couldn't ${step}:`, reply.status || "no response", error?.code, error?.requestId)
  return "error" as const
}
