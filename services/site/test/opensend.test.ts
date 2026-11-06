import { describe, expect, test } from "bun:test"
import { newsletterList, subscribe, type Signup } from "../src/lib/opensend"

type Contact = {
  id: string
  email: string
  marketingConsent: "unknown" | "subscribed" | "unsubscribed"
  suppressed: boolean
  suppressionReason: string | null
  deleted?: boolean
  listIds: string[]
}
type Sent = { method: string; path: string; authorization: string | null; body: unknown }

// A small stand-in for OpenSend's contact, consent and list routes, with the same rules: an
// address has one contact even once deleted, and a prior opt-out isn't replaced without
// confirmResubscribe.
function openSend(contacts: Contact[] = [], fail?: (sent: Sent) => Response | undefined) {
  const sent: Sent[] = []
  const error = (status: number, code: string, field?: string) =>
    Response.json({ error: { code, message: code, requestId: "req_test", field, retryable: false } }, { status })
  const find = (id: string) => contacts.find((contact) => contact.id === id && !contact.deleted)
  const fetch = async (input: string, init: RequestInit) => {
    const url = new URL(input)
    const body = init.body ? JSON.parse(String(init.body)) : undefined
    const request = {
      method: init.method ?? "GET",
      path: url.pathname + url.search,
      authorization: new Headers(init.headers).get("authorization"),
      body,
    }
    sent.push(request)
    const failure = fail?.(request)
    if (failure) return failure
    if (url.origin !== "https://opensend.anoma.ly") return error(404, "NOT_FOUND")
    const route = `${request.method} ${url.pathname}`
    if (route === "GET /v1/contacts") {
      const email = url.searchParams.get("email")!
      if (!email.includes("@") || email.endsWith("@")) return error(422, "VALIDATION_FAILED", "email")
      return Response.json({ data: contacts.filter((c) => c.email === email && !c.deleted), nextCursor: null })
    }
    if (route === "POST /v1/contacts") {
      if (contacts.some((contact) => contact.email === body.email)) return error(409, "CONTACT_EXISTS")
      const contact: Contact = {
        id: `con_${contacts.length + 1}`,
        email: body.email,
        marketingConsent: "unknown",
        suppressed: false,
        suppressionReason: null,
        listIds: [],
      }
      contacts.push(contact)
      const { listIds, ...created } = contact
      return Response.json(created, { status: 201 })
    }
    const consent = url.pathname.match(/^\/v1\/contacts\/([^/]+)\/consent$/)
    if (request.method === "POST" && consent) {
      const contact = find(decodeURIComponent(consent[1]))
      if (!contact) return error(404, "NOT_FOUND")
      if (contact.marketingConsent === "unsubscribed" && !body.confirmResubscribe)
        return error(409, "RESUBSCRIBE_CONFIRMATION_REQUIRED", "confirmResubscribe")
      contact.marketingConsent = body.status
      return Response.json(contact)
    }
    const members = url.pathname.match(/^\/v1\/lists\/([^/]+)\/members$/)
    if (request.method === "POST" && members) {
      const added = body.contactIds.filter((id: string) => {
        const contact = find(id)!
        if (contact.listIds.includes(members[1])) return false
        contact.listIds.push(members[1])
        return true
      })
      return Response.json({ added: added.length })
    }
    return error(404, "NOT_FOUND")
  }
  return { contacts, sent, fetch }
}

const at = new Date("2026-11-06T12:00:00.000Z")
const signup = (server: ReturnType<typeof openSend>, email = "new@example.com"): Signup => ({
  key: "os_test_key",
  email,
  page: "https://opencode.ai/",
  at,
  fetch: server.fetch,
})
const contact = (patch: Partial<Contact>): Contact => ({
  id: "con_existing",
  email: "known@example.com",
  marketingConsent: "subscribed",
  suppressed: false,
  suppressionReason: null,
  listIds: [],
  ...patch,
})
const routes = (sent: Sent[]) => sent.map((request) => `${request.method} ${request.path}`)

describe("OpenSend sign-up", () => {
  test("creates the contact, records consent from the form and adds it to the newsletter list", async () => {
    const server = openSend()
    expect(await subscribe(signup(server))).toBe("subscribed")
    expect(server.sent).toEqual([
      {
        method: "GET",
        path: "/v1/contacts?email=new%40example.com&limit=1",
        authorization: "Bearer os_test_key",
        body: undefined,
      },
      { method: "POST", path: "/v1/contacts", authorization: "Bearer os_test_key", body: { email: "new@example.com" } },
      {
        method: "POST",
        path: "/v1/contacts/con_1/consent",
        authorization: "Bearer os_test_key",
        body: {
          status: "subscribed",
          source: "opencode.ai sign-up form",
          evidence: "Submitted the newsletter sign-up form on https://opencode.ai/",
          occurredAt: "2026-11-06T12:00:00.000Z",
        },
      },
      {
        method: "POST",
        path: `/v1/lists/${newsletterList}/members`,
        authorization: "Bearer os_test_key",
        body: { contactIds: ["con_1"] },
      },
    ])
    expect(server.contacts[0]).toMatchObject({ marketingConsent: "subscribed", listIds: [newsletterList] })
  })

  test("a repeated sign-up writes nothing and says the address is already on the list", async () => {
    const server = openSend()
    await subscribe(signup(server))
    server.sent.length = 0
    expect(await subscribe(signup(server))).toBe("already")
    expect(routes(server.sent)).toEqual(["GET /v1/contacts?email=new%40example.com&limit=1"])
  })

  test("adds a subscribed contact from another list without recording consent again", async () => {
    const server = openSend([contact({ listIds: ["lst_other"] })])
    expect(await subscribe(signup(server, "known@example.com"))).toBe("subscribed")
    expect(routes(server.sent)).toEqual([
      "GET /v1/contacts?email=known%40example.com&limit=1",
      `POST /v1/lists/${newsletterList}/members`,
    ])
  })

  test("records consent for a listed contact whose consent was unknown", async () => {
    const server = openSend([contact({ marketingConsent: "unknown", listIds: [newsletterList] })])
    expect(await subscribe(signup(server, "known@example.com"))).toBe("subscribed")
    expect(routes(server.sent)).toEqual([
      "GET /v1/contacts?email=known%40example.com&limit=1",
      "POST /v1/contacts/con_existing/consent",
    ])
  })

  test("leaves unsubscribed and suppressed addresses alone", async () => {
    for (const existing of [
      contact({ marketingConsent: "unsubscribed", listIds: [newsletterList] }),
      contact({ suppressed: true, suppressionReason: "hard_bounce" }),
    ]) {
      const server = openSend([existing])
      expect(await subscribe(signup(server, "known@example.com"))).toBe("error")
      expect(routes(server.sent)).toEqual(["GET /v1/contacts?email=known%40example.com&limit=1"])
    }
  })

  test("an address OpenSend rejects is invalid", async () => {
    const server = openSend()
    expect(await subscribe(signup(server, "someone@"))).toBe("invalid")
  })

  test("uses the contact another request created between the lookup and the create", async () => {
    const server = openSend([], (request) => {
      if (request.method === "GET" && server.sent.length === 1) return Response.json({ data: [], nextCursor: null })
    })
    server.contacts.push(contact({ email: "new@example.com", marketingConsent: "unknown" }))
    expect(await subscribe(signup(server))).toBe("subscribed")
    expect(routes(server.sent)).toEqual([
      "GET /v1/contacts?email=new%40example.com&limit=1",
      "POST /v1/contacts",
      "GET /v1/contacts?email=new%40example.com&limit=1",
      "POST /v1/contacts/con_existing/consent",
      `POST /v1/lists/${newsletterList}/members`,
    ])
  })

  test("a deleted address can't sign up again from the form", async () => {
    const server = openSend([contact({ email: "new@example.com", deleted: true })])
    expect(await subscribe(signup(server))).toBe("error")
  })

  test("fails when OpenSend is down or refuses a step", async () => {
    const down = openSend([], () => Response.json({}, { status: 503 }))
    expect(await subscribe(signup(down))).toBe("error")
    const offline = { ...signup(openSend()), fetch: () => Promise.reject(new Error("offline")) }
    expect(await subscribe(offline)).toBe("error")
    const refused = openSend([], (request) =>
      request.path.endsWith("/members") ? Response.json({}, { status: 500 }) : undefined,
    )
    expect(await subscribe(signup(refused))).toBe("error")
  })
})
