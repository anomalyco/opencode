import { handleEnterpriseRequest } from "../src/routes/api/enterprise"
import { z } from "zod"
import { SalesforceCliError, salesforceCliResponse } from "./salesforce-cli-response"
import { handleConsoleSignup } from "../src/routes/api/console-signup"
import { consoleAccountSchema } from "../src/lib/console-account"

const org = process.env.SF_TARGET_ORG || "opencode"
const crmToken = process.env.CONSOLE_CRM_TOKEN
if (!crmToken) throw new Error("Set CONSOLE_CRM_TOKEN to the shared local Console CRM token")
const accountUrl = process.env.CONSOLE_CRM_LOOKUP_URL || "http://localhost:3100/console/api/internal/console-account"

async function authenticatedRequest(
  path: string,
  payload?: Record<string, unknown>,
  method: "GET" | "POST" | "PATCH" = payload ? "POST" : "GET",
) {
  const child = Bun.spawn(
    [
      "sf",
      "api",
      "request",
      "rest",
      path,
      "--target-org",
      org,
      "--json",
      "--method",
      method,
      ...(payload ? ["--body", "-", "--header", "Content-Type:application/json"] : []),
    ],
    {
      stdin: payload ? new Blob([JSON.stringify(payload)]) : "ignore",
      stdout: "pipe",
      stderr: "pipe",
    },
  )
  const [output] = await Promise.all([
    new Response(child.stdout).text(),
    child.exited,
    new Response(child.stderr).text(),
  ])
  return salesforceCliResponse(output)
}

await authenticatedRequest("/services/data/v59.0/")

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: Number(process.env.ENTERPRISE_DEV_PORT || 3101),
  async fetch(request) {
    const path = new URL(request.url).pathname
    if (path === "/health" && request.method === "GET") {
      return Response.json({ handler: "local-sst-enterprise", salesforceOrg: org })
    }
    if (path === "/api/console-signup" && request.method === "POST") {
      return handleConsoleSignup(request, crmToken, (path, method, payload) =>
        authenticatedRequest(path, payload, method),
      )
    }
    if (path !== "/api/enterprise") return new Response("Not found", { status: 404 })
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 })
    const failures: string[] = []
    const response = await handleEnterpriseRequest(request, {
      salesforceSubmit: async (payload) => {
        const result = await authenticatedRequest("/services/data/v59.0/sobjects/Lead", payload).catch(
          (error: unknown) => {
            const code = error instanceof SalesforceCliError ? error.code : "CLI_ERROR"
            failures.push(code)
            console.error(`Local Salesforce submission rejected: ${code}`)
            return undefined
          },
        )
        return z.object({ success: z.literal(true) }).safeParse(result).success
      },
      notifications: false,
      accountLookup: async (email) => {
        const response = await fetch(accountUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${crmToken}` },
          body: JSON.stringify({ email }),
          signal: AbortSignal.timeout(8000),
        })
        if (!response.ok) throw new Error(`Local Console account lookup failed (${response.status})`)
        return z.object({ account: consoleAccountSchema.nullable() }).parse(await response.json()).account
      },
    })
    if (failures.length > 0) {
      return Response.json(
        { error: "Salesforce rejected the request.", errorCode: failures[0] },
        { status: 502, headers: { "X-Enterprise-Handler": "local-sst-enterprise" } },
      )
    }
    response.headers.set("X-Enterprise-Handler", "local-sst-enterprise")
    return response
  },
})

console.log(`Local Enterprise handler: ${server.url.origin}/api/enterprise`)
console.log(`Salesforce CLI org: ${org}; local email and EmailOctopus delivery disabled.`)
