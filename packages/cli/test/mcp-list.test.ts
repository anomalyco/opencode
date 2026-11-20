import { expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { Effect } from "effect"
import { OpenCode } from "@opencode/client"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { resolveIntegration } from "../src/commands/handlers/mcp/resolve"
import { isolatedEnv } from "./fixture/environment"

test("standalone mcp list loads project-level MCP servers on the first run", async () => {
  await using root = await tmpdir("opencode-cli-mcp-list-")
  const project = path.join(root.path, "project")
  await fs.mkdir(project, { recursive: true })
  const preload = fileURLToPath(import.meta.resolve("@opentui/solid/preload"))
  // Running the TypeScript CLI entrypoint from a temp directory outside the repo needs the Solid
  // preload for both the CLI process and the standalone `serve` child it spawns.
  await fs.writeFile(path.join(project, "bunfig.toml"), `preload = [${JSON.stringify(preload)}]\n`)
  await fs.writeFile(
    path.join(project, "opencode.json"),
    JSON.stringify({
      mcp: {
        servers: {
          "project-demo": {
            type: "local",
            command: ["echo", "unused"],
            disabled: true,
          },
        },
      },
    }),
  )

  const child = Bun.spawn(
    [process.execPath, path.join(import.meta.dir, "../src/index.ts"), "--standalone", "mcp", "list"],
    {
      cwd: project,
      env: isolatedEnv(root.path, { OPENCODE_CONFIG_CONTENT: undefined }),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    },
  )
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])

  expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" })
  expect(stdout).toContain("project-demo")
  expect(stdout).toContain("disabled")
}, 60_000) // --standalone boots both the CLI and its serve child and activates built-in plugins on a cold Location.

test("resolveIntegration waits for plugins before listing MCP servers", async () => {
  const location = { directory: "/project" }
  const calls: string[] = []
  let pluginPolls = 0
  const client = OpenCode.make({
    baseUrl: "http://opencode.local",
    fetch: Object.assign(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL((input instanceof Request ? input : new Request(input, init)).url)
        calls.push(url.pathname)
        if (url.pathname === "/api/plugin") {
          pluginPolls++
          return Response.json({
            location,
            data:
              pluginPolls < 2
                ? []
                : [{ id: "opencode.config.mcp", source: { type: "builtin" }, state: { status: "active" } }],
          })
        }
        if (url.pathname === "/api/mcp") {
          return Response.json({
            location,
            data:
              pluginPolls < 2
                ? []
                : [
                    {
                      name: "project-remote",
                      status: { status: "needs_auth", error: "login" },
                      integrationID: "mcp_1",
                    },
                  ],
          })
        }
        if (url.pathname === "/api/integration/mcp_1") {
          return Response.json({
            location,
            data: { id: "mcp_1", name: "project-remote", methods: [], connections: [] },
          })
        }
        return new Response("Not found", { status: 404 })
      },
      { preconnect: fetch.preconnect },
    ),
  })

  const resolved = await Effect.runPromise(resolveIntegration(client, "project-remote", location))
  expect(resolved).toMatchObject({ id: "mcp_1", name: "project-remote" })
  expect(calls).toEqual(["/api/plugin", "/api/plugin", "/api/mcp", "/api/integration/mcp_1"])
})
