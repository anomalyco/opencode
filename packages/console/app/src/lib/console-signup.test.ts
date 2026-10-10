import { afterEach, expect, test } from "bun:test"
import { syncConsoleAccount, type SalesforceRequest } from "./salesforce"
import { handleConsoleSignup } from "../routes/api/console-signup"
import { z } from "zod"

const account = {
  id: "user_console_test",
  email: "person@example.test",
  name: "Test Person",
  createdAt: "2026-10-01T10:00:00.000Z",
}
const servers = new Set<ReturnType<typeof Bun.serve>>()
afterEach(async () => {
  await Promise.all([...servers].map((server) => server.stop(true)))
  servers.clear()
})

function fixture(
  initial: { object: "Lead" | "Contact"; Id: string; LeadSource: string; Company?: string; AccountId?: string }[] = [],
  email = account.email,
) {
  const people: Record<string, unknown>[] = initial.map((person) => ({ ...person }))
  const writes: { method: string; path: string; payload: Record<string, unknown> }[] = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      if (url.pathname.endsWith("/query")) {
        const query = url.searchParams.get("q") ?? ""
        expect(query).toContain("Console_Account_ID__c")
        expect(query).toContain(`Email = '${email.toLowerCase()}'`)
        const object = query.includes("FROM Contact") ? "Contact" : "Lead"
        if (object === "Lead") expect(query).toContain("IsConverted = false")
        return Response.json({
          done: true,
          records: people.filter((person) => person.object === object).map((person) => ({ Id: person.Id })),
        })
      }
      const payload = z.record(z.string(), z.unknown()).parse(await request.json())
      writes.push({ method: request.method, path: url.pathname, payload })
      if (request.method === "PATCH") {
        const person = people.find((person) => person.Id === url.pathname.split("/").at(-1))
        if (!person) return Response.json({ error: "Not found" }, { status: 404 })
        Object.assign(person, payload)
        return new Response(null, { status: 204 })
      }
      const id = "00Q000000000001AAA"
      people.push({ object: "Lead", Id: id, ...payload })
      return Response.json({ success: true, id }, { status: 201 })
    },
  })
  servers.add(server)
  const request: SalesforceRequest = async (path, method = "GET", payload) => {
    const response = await fetch(new URL(path, server.url), {
      method,
      ...(payload ? { body: JSON.stringify(payload), headers: { "Content-Type": "application/json" } } : {}),
    })
    if (!response.ok) throw new Error("CRM request failed")
    return response.status === 204 ? null : response.json()
  }
  return { people, writes, request }
}

test("a new signup creates one Console lead and an exact retry updates it", async () => {
  const crm = fixture()
  await syncConsoleAccount(account, crm.request)
  await syncConsoleAccount(account, crm.request)
  expect(crm.people).toHaveLength(1)
  expect(crm.writes.filter((write) => write.method === "POST")).toHaveLength(1)
  expect(crm.people[0]).toMatchObject({
    Company: "example.test",
    LeadSource: "console signup",
    Has_Console_Account__c: true,
    Console_Account_ID__c: account.id,
    Console_Signup_Date__c: account.createdAt,
  })
  expect(crm.writes[1].payload).not.toHaveProperty("LeadSource")
  expect(crm.writes[1].payload).not.toHaveProperty("Company")
})

test.each([
  ["hello@acme.com", "acme.com"],
  ["jane@company.co.uk", "company.co.uk"],
  ["HELLO@ACME.COM", "acme.com"],
  ["person@gmail.com", "Individual"],
  ["person+signup@GOOGLEMAIL.COM", "Individual"],
  ["person@outlook.com", "Individual"],
  ["person@hotmail.co.uk", "Individual"],
  ["person@yahoo.com", "Individual"],
  ["person@icloud.com", "Individual"],
  ["person@proton.me", "Individual"],
  ["person@protonmail.com", "Individual"],
  ["person@pm.me", "Individual"],
  ["person@aol.com", "Individual"],
  ["person@gmail.com.example.test", "gmail.com.example.test"],
])("sets Company for a new signup with %s to %s", async (email, company) => {
  const crm = fixture([], email)
  await syncConsoleAccount({ ...account, email }, crm.request)
  expect(crm.people).toHaveLength(1)
  expect(crm.people[0]).toMatchObject({ Company: company, Email: email.toLowerCase(), LeadSource: "console signup" })
})

test("matching Leads and Contacts keep their source and receive the Console fields", async () => {
  const crm = fixture([
    { object: "Contact", Id: "003000000000001AAA", LeadSource: "Partner", AccountId: "001000000000001AAA" },
    { object: "Lead", Id: "00Q000000000002AAA", LeadSource: "enterprise website form", Company: "Visitor's Company" },
  ])
  await syncConsoleAccount(account, crm.request)
  expect(crm.writes.every((write) => write.method === "PATCH")).toBe(true)
  expect(crm.people.map((person) => person.LeadSource)).toEqual(["Partner", "enterprise website form"])
  expect(crm.people[0].AccountId).toBe("001000000000001AAA")
  expect(crm.people[1].Company).toBe("Visitor's Company")
  for (const write of crm.writes) {
    expect(write.payload).not.toHaveProperty("Company")
    expect(write.payload).not.toHaveProperty("AccountId")
  }
  for (const person of crm.people)
    expect(person).toMatchObject({
      Has_Console_Account__c: true,
      Console_Account_ID__c: account.id,
      Console_Signup_Date__c: account.createdAt,
    })
})

test("a converted person's Contact is updated without creating another Lead", async () => {
  const crm = fixture([{ object: "Contact", Id: "003000000000001AAA", LeadSource: "Website" }])
  await syncConsoleAccount(account, crm.request)
  expect(crm.people).toHaveLength(1)
  expect(crm.writes[0].path).toContain("/Contact/")
  expect(crm.people[0].LeadSource).toBe("Website")
})

test("the signup endpoint requires its server credential before touching Salesforce", async () => {
  const crm = fixture()
  const response = await handleConsoleSignup(
    new Request("http://localhost/api/console-signup", { method: "POST", body: JSON.stringify(account) }),
    "test-shared-token",
    crm.request,
  )
  expect(response.status).toBe(401)
  expect(crm.writes).toHaveLength(0)
})

test("the authenticated signup endpoint reports confirmed delivery", async () => {
  const crm = fixture()
  const response = await handleConsoleSignup(
    new Request("http://localhost/api/console-signup", {
      method: "POST",
      headers: { Authorization: "Bearer test-shared-token" },
      body: JSON.stringify(account),
    }),
    "test-shared-token",
    crm.request,
  )
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ success: true })
  expect(crm.people).toHaveLength(1)
})
