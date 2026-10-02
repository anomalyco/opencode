import { describe, expect, test } from "bun:test"
import path from "node:path"
import { OPENCODE_VERSION } from "../src/version"
import type { FormFields } from "@opencode/client"

const consoleForm = [
  { type: "string", key: "server", hidden: true, format: "uri", default: "https://opencode.ai/console" },
] satisfies FormFields

describe("auth command", () => {
  test("registers authentication commands", async () => {
    const [auth, list, login, logout] = await Promise.all([
      cli(["auth", "--help"]),
      cli(["auth", "list", "--help"]),
      cli(["auth", "login", "--help"]),
      cli(["auth", "logout", "--help"]),
    ])

    expect(auth.exitCode).toBe(0)
    expect(auth.stdout).toContain("list")
    expect(auth.stdout).toContain("login")
    expect(auth.stdout).toContain("logout")
    expect(auth.stdout).toContain("manage integrations and credentials")
    expect(auth.stdout).toContain("list integrations and credentials")
    expect(auth.stdout).toContain("connect an integration")
    expect(auth.stdout).toContain("log out of a saved account")
    expect(auth.stdout).toContain("switch the active account for an integration")
    expect(auth.stdout).not.toMatch(/^  connect\s/m)
    expect(list.exitCode).toBe(0)
    expect(list.stdout).toContain("opencode auth list [flags]")
    expect(list.stdout).toContain("--format")
    expect(login.exitCode).toBe(0)
    expect(login.stdout).toContain("opencode auth login [flags] [<target>]")
    expect(login.stdout).toContain("Integration ID, name, or well-known provider URL")
    expect(login.stdout).toContain("--method")
    expect(login.stdout).toContain("--answer")
    expect(logout.exitCode).toBe(0)
    expect(logout.stdout).toContain("opencode auth logout [flags] [<target>] [<credential>]")
  })

  test("lists stored and environment connections", async () => {
    const requests: string[] = []
    using server = authServer((request, url) => {
      if (url.pathname === "/api/integration") {
        return Response.json(
          located([
            {
              id: "anthropic",
              name: "Anthropic",
              methods: [],
              connections: [
                { type: "credential", method: "key", id: "cred_test", label: "default" },
                { type: "env", name: "ANTHROPIC_API_KEY" },
              ],
            },
            { id: "openai", name: "OpenAI", methods: [], connections: [] },
          ]),
        )
      }
      return new Response("Not found", { status: 404 })
    }, requests)

    const result = await cli(["auth", "list", "--format", "json", "--server", server.url.toString()])
    expect({ exitCode: result.exitCode, stderr: result.stderr }).toEqual({ exitCode: 0, stderr: "" })
    expect(JSON.parse(result.stdout)).toEqual([
      {
        id: "anthropic",
        name: "Anthropic",
        connections: [
          { type: "credential", method: "key", id: "cred_test", label: "default" },
          { type: "env", name: "ANTHROPIC_API_KEY" },
        ],
      },
    ])
    expect(requests.indexOf("/api/model/default")).toBeLessThan(requests.indexOf("/api/integration"))
  })

  test("lists OpenCode Go before Zen and preserves the remaining integration order", async () => {
    using server = authServer((request, url) => {
      if (url.pathname === "/api/integration") {
        return Response.json(
          located(
            [
              { id: "opencode", name: "OpenCode Zen" },
              { id: "anthropic", name: "Anthropic" },
              { id: "opencode-go", name: "OpenCode Go" },
            ].map((integration) => ({
              ...integration,
              methods: [],
              connections: [{ type: "env", name: "TEST_API_KEY" }],
            })),
          ),
        )
      }
      return new Response("Not found", { status: 404 })
    })

    const result = await cli(["auth", "list", "--server", server.url.toString()])
    expect({ exitCode: result.exitCode, stderr: result.stderr }).toEqual({ exitCode: 0, stderr: "" })
    expect(
      result.stdout
        .trim()
        .split("\n")
        .map((line) => line.split(/\s{2,}/)[0]),
    ).toEqual(["OpenCode Go", "OpenCode Zen", "Anthropic"])
  })

  test("runs command authentication without interactive input", async () => {
    const requests: Array<{ method: string; path: string }> = []
    using server = authServer((request, url) => {
      requests.push({ method: request.method, path: url.pathname })
      if (url.pathname === "/api/integration") {
        return Response.json(
          located([
            {
              id: "company",
              name: "Company",
              methods: [{ id: "login", type: "command", label: "Company login", command: ["company", "login"] }],
              connections: [],
            },
          ]),
        )
      }
      if (url.pathname === "/api/integration/company/connect/command" && request.method === "POST") {
        return Response.json(located({ attemptID: "con_test", time: { created: 1, expires: 2 } }))
      }
      if (url.pathname === "/api/integration/company/connect/command/con_test" && request.method === "GET") {
        return Response.json(located({ status: "complete", time: { created: 1, expires: 2 } }))
      }
      if (url.pathname === "/api/integration/company/connect/command/con_test" && request.method === "DELETE") {
        return new Response(null, { status: 204 })
      }
      return new Response("Not found", { status: 404 })
    })

    const result = await cli(["auth", "login", "company", "--server", server.url.toString()])
    expect({ exitCode: result.exitCode, stderr: result.stderr }).toEqual({ exitCode: 0, stderr: "" })
    expect(result.stdout).toContain("Connected to Company")
    expect(requests).toContainEqual({ method: "POST", path: "/api/integration/company/connect/command" })
    expect(requests).toContainEqual({ method: "GET", path: "/api/integration/company/connect/command/con_test" })
    expect(requests).toContainEqual({ method: "DELETE", path: "/api/integration/company/connect/command/con_test" })
  })

  test.each([
    { id: "openai", method: "browser", form: undefined, args: [], answer: undefined },
    {
      id: "opencode",
      method: "device",
      form: consoleForm,
      args: [],
      answer: { server: "https://opencode.ai/console" },
    },
    {
      id: "opencode",
      method: "device",
      form: consoleForm,
      args: ["--answer", "server=https://staging.example.com/console"],
      answer: { server: "https://staging.example.com/console" },
    },
    {
      id: "company",
      method: "browser",
      form: [
        { type: "string", key: "tenant", required: true },
        { type: "boolean", key: "enabled", required: true },
      ] satisfies FormFields,
      args: ["--answer", "tenant=team=one", "--answer", "enabled=false"],
      answer: { tenant: "team=one", enabled: false },
    },
  ])("completes $id/$method OAuth with supplied answers $args", async (input) => {
    const requests: Array<{ method: string; path: string }> = []
    const bodies: unknown[] = []
    const endpoint = `/api/integration/${input.id}/connect/oauth`
    using server = authServer(async (request, url) => {
      requests.push({ method: request.method, path: url.pathname })
      if (url.pathname === "/api/integration") {
        return Response.json(
          located([
            {
              id: input.id,
              name: input.id,
              methods: [{ id: input.method, type: "oauth", label: "Browser", form: input.form }],
              connections: [],
            },
          ]),
        )
      }
      if (url.pathname === endpoint && request.method === "POST") {
        bodies.push(await request.json())
        return Response.json(
          located({
            attemptID: "con_oauth",
            url: "https://example.com/authorize",
            instructions: "Authorize OpenAI",
            mode: "auto",
            time: { created: 1, expires: 2 },
          }),
        )
      }
      if (url.pathname === `${endpoint}/con_oauth` && request.method === "GET") {
        return Response.json(located({ status: "complete", time: { created: 1, expires: 2 } }))
      }
      if (url.pathname === `${endpoint}/con_oauth` && request.method === "DELETE") {
        return new Response(null, { status: 204 })
      }
      return new Response("Not found", { status: 404 })
    })

    const result = await cli(["auth", "login", input.id, "--server", server.url.toString(), ...input.args])
    expect({ exitCode: result.exitCode, stderr: result.stderr }).toEqual({ exitCode: 0, stderr: "" })
    expect(result.stdout).toContain("https://example.com/authorize")
    expect(result.stdout).toContain(`Connected to ${input.id}`)
    expect(bodies).toEqual([{ methodID: input.method, ...(input.answer ? { answer: input.answer } : {}) }])
    expect(requests).toContainEqual({ method: "POST", path: endpoint })
    expect(requests).toContainEqual({ method: "GET", path: `${endpoint}/con_oauth` })
    expect(requests).toContainEqual({ method: "DELETE", path: `${endpoint}/con_oauth` })
  })

  test("reports OAuth status polling failures and cancels the attempt", async () => {
    let cancelled = false
    using server = authServer((request, url) => {
      if (url.pathname === "/api/integration") {
        return Response.json(
          located([
            {
              id: "openai",
              name: "OpenAI",
              methods: [{ id: "browser", type: "oauth", label: "Browser" }],
              connections: [],
            },
          ]),
        )
      }
      if (url.pathname === "/api/integration/openai/connect/oauth" && request.method === "POST") {
        return Response.json(
          located({
            attemptID: "con_oauth",
            url: "https://example.com/authorize",
            instructions: "Authorize OpenAI",
            mode: "auto",
            time: { created: 1, expires: 2 },
          }),
        )
      }
      if (url.pathname === "/api/integration/openai/connect/oauth/con_oauth" && request.method === "GET") {
        return new Response("Unavailable", { status: 500 })
      }
      if (url.pathname === "/api/integration/openai/connect/oauth/con_oauth" && request.method === "DELETE") {
        cancelled = true
        return new Response(null, { status: 204 })
      }
      return new Response("Not found", { status: 404 })
    })

    const result = await cli(["auth", "login", "openai", "--server", server.url.toString()])
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toContain("Waiting for authorization...")
    expect(result.stdout).toContain("UnexpectedStatus: 500")
    expect(result.stdout).toContain("Failed")
    expect(cancelled).toBe(true)
    expect(result.stdout).not.toContain("\n    at ")
  })

  test("removes a selected stored credential", async () => {
    const removed: string[] = []
    using server = authServer((request, url) => {
      if (url.pathname === "/api/integration") {
        return Response.json(
          located([
            {
              id: "anthropic",
              name: "Anthropic",
              methods: [{ type: "key" }],
              connections: [{ type: "credential", method: "key", id: "cred_test", label: "default" }],
            },
          ]),
        )
      }
      if (url.pathname === "/api/credential/cred_test" && request.method === "DELETE") {
        removed.push("cred_test")
        return new Response(null, { status: 204 })
      }
      return new Response("Not found", { status: 404 })
    })

    const result = await cli(["auth", "logout", "anthropic", "cred_test", "--server", server.url.toString()])
    expect({ exitCode: result.exitCode, stderr: result.stderr }).toEqual({ exitCode: 0, stderr: "" })
    expect(result.stdout).toContain("Removed account from Anthropic")
    expect(removed).toEqual(["cred_test"])
  })

  test("requires a target outside an interactive terminal", async () => {
    const result = await cli(["auth", "login"])
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toContain("Pass an integration ID or name")
    expect(result.stdout).not.toContain("Background service failed to start")
  })

  test("reports list connection failures without a stack trace", async () => {
    using server = Bun.serve({ port: 0, fetch: () => new Response("Unavailable", { status: 503 }) })
    const result = await cli(["auth", "list", "--server", server.url.toString()])
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe("")
    expect(result.stderr).toContain("did not provide a compatible V2 health response")
    expect(result.stderr).not.toContain("\n    at ")
  })
})

function authServer(fetch: (request: Request, url: URL) => Response | Promise<Response>, requests?: string[]) {
  return Bun.serve({
    port: 0,
    fetch(request) {
      const url = new URL(request.url)
      requests?.push(url.pathname)
      if (url.pathname === "/api/info") return status()
      if (url.pathname === "/api/model/default") return Response.json(located(null))
      return fetch(request, url)
    },
  })
}

function status() {
  return Response.json({ version: OPENCODE_VERSION, pid: process.pid, urls: [], paths: { tmp: "/tmp/opencode" } })
}

function located<T>(data: T) {
  return {
    location: {
      directory: process.cwd(),
      project: { id: "project", directory: process.cwd(), canonical: process.cwd() },
    },
    data,
  }
}

async function cli(args: string[]) {
  const child = Bun.spawn([process.execPath, "run", "src/index.ts", ...args], {
    cwd: path.join(import.meta.dir, ".."),
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { stdout, stderr, exitCode }
}
