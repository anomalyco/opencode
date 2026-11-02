import { afterEach, expect, mock, spyOn, test } from "bun:test"
import type { sendEmail } from "./aws"
import { enterpriseEmailContent, handleEnterpriseRequest } from "./enterprise"

afterEach(() => mock.restore())

const submission = {
  name: "Fake Visitor",
  role: "Engineering lead",
  company: "Example Test Company",
  email: "fake-visitor@example.test",
  message: "We need SSO for 200 developers.",
}

test("the sales inbox email escapes submitted HTML", () => {
  const content = enterpriseEmailContent({
    name: "<b>Name</b>",
    role: "Role",
    email: "fake-visitor@example.test",
    message: `<script>alert("x")</script> & <img src=x onerror=alert(1)>`,
    alias: "",
  })
  expect(content.html).not.toContain("<script>")
  expect(content.html).not.toContain("<img")
  expect(content.html).not.toContain("<b>")
  expect(content.html).toContain(
    "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &lt;img src=x onerror=alert(1)&gt;",
  )
  expect(content.html).toContain("&lt;b&gt;Name&lt;/b&gt;<br>")
})

test("the sales inbox plain-text email is not HTML-escaped", () => {
  const content = enterpriseEmailContent(
    { ...submission, name: "Ada <CTO>", message: "Pricing & SSO?", phone: "+1 555 0100", alias: "" },
    "$10k+",
  )
  expect(content.text).not.toContain("<br>")
  expect(content.text).not.toContain("&lt;")
  expect(content.text).not.toContain("&amp;")
  expect(content.text).toBe(
    [
      "Pricing & SSO?",
      "",
      "Current monthly inference spend: $10k+",
      "",
      "--",
      "Ada <CTO>",
      submission.role,
      submission.company,
      submission.email,
      "+1 555 0100",
    ].join("\n"),
  )
})

const contact = async (fields: Record<string, unknown>) => {
  const sent: Parameters<typeof sendEmail>[0][] = []
  const leads: Record<string, unknown>[] = []
  const response = await handleEnterpriseRequest(
    new Request("http://localhost/api/enterprise", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "fake-visitor@example.test",
        message: "We'd like to list our models.",
        captcha: "token",
        ...fields,
      }),
    }),
    {
      captcha: { secret: "test-secret", fetch: async () => Response.json({ success: true }) },
      spam: { apiKey: "test-key", fetch: async () => new Response(null, { status: 503 }) },
      salesforceSubmit: async (payload) => {
        leads.push(payload)
        return true
      },
      send: async (email) => {
        sent.push(email)
      },
    },
  )
  return { status: response.status, sent, leads }
}

test("an inquiry that isn't for sales is emailed to the contact inbox, titled with its reason, without a lead", async () => {
  spyOn(console, "error").mockImplementation(() => {})
  const result = await contact({ reason: "list-models", message: "<b>Our</b> models" })
  expect(result.status).toBe(200)
  expect(result.leads).toHaveLength(0)
  expect(result.sent).toEqual([
    {
      to: "stefan@anoma.ly",
      subject: "List my models on OpenCode",
      body: "&lt;b&gt;Our&lt;/b&gt; models<br><br>--<br>fake-visitor@example.test",
      text: "<b>Our</b> models\n\n--\nfake-visitor@example.test",
      replyTo: "fake-visitor@example.test",
    },
  ])
})

test("an inquiry with an unknown reason or no details is rejected before anything is sent", async () => {
  expect(await contact({ reason: "Get help with my account" })).toEqual({ status: 400, sent: [], leads: [] })
  expect(await contact({ reason: "account", message: "" })).toEqual({ status: 400, sent: [], leads: [] })
})

test("a contact email that fails to send is reported", async () => {
  spyOn(console, "error").mockImplementation(() => {})
  const response = await handleEnterpriseRequest(
    new Request("http://localhost/api/enterprise", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "fake-visitor@example.test",
        message: "Help",
        reason: "account",
        captcha: "token",
      }),
    }),
    {
      captcha: { secret: "test-secret", fetch: async () => Response.json({ success: true }) },
      spam: { apiKey: "test-key", fetch: async () => new Response(null, { status: 503 }) },
      send: async () => {
        throw new Error("SES down")
      },
    },
  )
  expect(response.status).toBe(500)
})
