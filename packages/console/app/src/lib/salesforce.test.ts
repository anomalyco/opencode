import { afterAll, expect, test } from "bun:test"

const leads: Record<string, unknown>[] = []
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request, instance) {
    const path = new URL(request.url).pathname
    if (path === "/services/oauth2/token") {
      return Response.json({ access_token: "local-test-token", instance_url: instance.url.origin })
    }
    if (path === "/services/data/v59.0/sobjects/Lead" && request.method === "POST") {
      leads.push(await request.json())
      return Response.json({ id: "local-test-lead", success: true }, { status: 201 })
    }
    return new Response("Not found", { status: 404 })
  },
})

const resources = {
  SST_RESOURCE_SALESFORCE_INSTANCE_URL: server.url.origin,
  SST_RESOURCE_SALESFORCE_CLIENT_ID: "local-test-client",
  SST_RESOURCE_SALESFORCE_CLIENT_SECRET: "local-test-secret",
}
const previous = Object.fromEntries(Object.keys(resources).map((key) => [key, process.env[key]]))
Object.entries(resources).forEach(([key, value]) => {
  process.env[key] = JSON.stringify({ value })
})

afterAll(async () => {
  await server.stop(true)
  Object.entries(previous).forEach(([key, value]) => {
    if (value === undefined) {
      delete process.env[key]
      return
    }
    process.env[key] = value
  })
})

test("a fake entry keeps the visitor message, spend range, and enterprise lead source in their own fields", async () => {
  const { createLead } = await import("./salesforce")
  const accepted = await createLead({
    name: "Fake Console Visitor",
    role: "Engineering lead",
    company: "Example Test Company",
    email: "fake-visitor@example.test",
    inferenceSpend: "$10K–$50K",
    message: "  We need SSO for our developers.\nPlease share the enterprise options.  ",
  })

  expect(accepted).toBe(true)
  expect(leads).toHaveLength(1)
  expect(leads[0]).toEqual({
    LastName: "Fake Console Visitor",
    Company: "Example Test Company",
    Email: "fake-visitor@example.test",
    Phone: null,
    Title: "Engineering lead",
    Description: "  We need SSO for our developers.\nPlease share the enterprise options.  ",
    Current_Monthly_Inference_Spend__c: "$10K–$50K",
    LeadSource: "enterprise website form",
  })
})

test("the local Enterprise request handler applies the updated mapping to a form submission", async () => {
  const { handleEnterpriseRequest } = await import("../routes/api/enterprise")
  const response = await handleEnterpriseRequest(
    new Request("http://localhost/api/enterprise", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Fake Local Form Visitor",
        role: "Engineering lead",
        company: "Example Test Company",
        email: "fake-local-visitor@example.test",
        inferenceSpend: "50k-100k",
        message: "  How are you bro!\nThis is a local form test.  ",
        alias: "",
      }),
    }),
    {
      salesforceSubmit: async (payload) => {
        const response = await fetch(`${server.url.origin}/services/data/v59.0/sobjects/Lead`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
        return response.ok
      },
      notifications: false,
      accountLookup: async () => ({
        id: "user_test",
        email: "fake-local-visitor@example.test",
        name: null,
        createdAt: "2026-10-01T12:00:00.000Z",
      }),
    },
  )

  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ success: true })
  expect(leads.at(-1)).toMatchObject({
    LastName: "Fake Local Form Visitor",
    Description: "  How are you bro!\nThis is a local form test.  ",
    Current_Monthly_Inference_Spend__c: "$50K–$100K",
    LeadSource: "enterprise website form",
    Has_Console_Account__c: true,
    Console_Account_ID__c: "user_test",
    Console_Signup_Date__c: "2026-10-01T12:00:00.000Z",
  })
})
