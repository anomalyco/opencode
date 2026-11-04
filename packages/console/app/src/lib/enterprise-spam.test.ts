import { afterEach, expect, mock, spyOn, test } from "bun:test"
import { enterpriseSpamProbability, ENTERPRISE_SPAM_MODEL, ENTERPRISE_SPAM_URL } from "./enterprise-spam"
import { handleEnterpriseRequest } from "./enterprise"

const submission = {
  name: "Fake Visitor",
  role: "Engineering lead",
  company: "Example Test Company",
  email: "fake-visitor@example.test",
  message: "We need SSO for 200 developers.",
}

afterEach(() => mock.restore())

const score = (probability: unknown) =>
  Response.json({ model: ENTERPRISE_SPAM_MODEL, answers: { spam: { type: "noul", noul: probability } } })

test("scores a submission through the System One gateway", async () => {
  const requests: Request[] = []
  // The form handler passes the whole submission, phone included; the classifier must not receive it.
  const withPhone = { ...submission, phone: "+1 555 0100" }
  const probability = await enterpriseSpamProbability(withPhone, {
    apiKey: "test-key",
    fetch: async (request) => {
      requests.push(request)
      return score(0.97)
    },
  })

  expect(probability).toBe(0.97)
  expect(requests).toHaveLength(1)
  expect(requests[0].url).toBe(ENTERPRISE_SPAM_URL)
  expect(requests[0].headers.get("authorization")).toBe("Bearer test-key")
  const body = await requests[0].json()
  expect(body.model).toBe(ENTERPRISE_SPAM_MODEL)
  expect(body.state.submission).toMatchObject({ email: submission.email, message: submission.message })
  expect(body.state.submission).not.toHaveProperty("phone")
  expect(body.questions.spam.type).toBe("noul")
})

test("returns no score when the gateway fails, times out, or answers without a probability", async () => {
  const options = { apiKey: "test-key" }
  const failures = [
    async () => new Response("nope", { status: 401 }),
    async () => {
      throw new Error("network")
    },
    async () => score("high"),
    async () => score(1.5),
    async () => Response.json({ answers: {} }),
    (request: Request) =>
      new Promise<Response>((_, reject) =>
        request.signal.addEventListener("abort", () => reject(request.signal.reason)),
      ),
  ]
  for (const fetch of failures) {
    expect(await enterpriseSpamProbability(submission, { ...options, timeoutMs: 20, fetch })).toBeUndefined()
  }
})

const submit = async (fetch: (request: Request) => Promise<Response>) => {
  const leads: Record<string, unknown>[] = []
  const response = await handleEnterpriseRequest(
    new Request("http://localhost/api/enterprise", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...submission, alias: "", captcha: "token" }),
    }),
    {
      captcha: { secret: "test-secret", fetch: async () => Response.json({ success: true }) },
      spam: { apiKey: "test-key", fetch },
      salesforceSubmit: async (payload) => {
        leads.push(payload)
        return true
      },
      notifications: false,
    },
  )
  return { status: response.status, body: await response.json(), leads }
}

test("confident spam gets the normal success response, never reaches Salesforce, and is logged", async () => {
  const warn = spyOn(console, "warn").mockImplementation(() => {})
  const result = await submit(async () => score(0.95))
  expect(result.status).toBe(200)
  expect(result.body).toMatchObject({ success: true })
  expect(result.leads).toHaveLength(0)
  expect(warn).toHaveBeenCalledWith("Enterprise inquiry dropped as spam", {
    email: submission.email,
    probability: 0.95,
  })
})

test("uncertain, missing, or failed scores still create the lead", async () => {
  spyOn(console, "error").mockImplementation(() => {})
  for (const fetch of [
    async () => score(0.6),
    async () => Response.json({ answers: {} }),
    async () => {
      throw new Error("classifier down")
    },
  ]) {
    const result = await submit(fetch)
    expect(result.status).toBe(200)
    expect(result.leads).toHaveLength(1)
  }
})
