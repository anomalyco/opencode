// Phase 6 (ARCHITECTURE §12 Server, §14): `oclite mcp serve` driven by real SDK clients over stdio and HTTP, and
// oclite↔oclite `transport: mcp` children. Every server is a spawned `bun src/index.ts mcp serve`; models are the fake.
import { describe, expect, test } from "bun:test"
import path from "path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { ElicitRequestSchema, LoggingMessageNotificationSchema } from "@modelcontextprotocol/sdk/types.js"
import { setup } from "../cli/harness"
import { isolatedEnv } from "../lib/cli"
import { reply } from "../lib/local-server"

const entry = path.resolve(import.meta.dir, "../../src/index.ts")
const TOKEN = "serve-token-7c1e9a44"
type Env = Awaited<ReturnType<typeof setup>>
type Out = Record<string, unknown>

async function configure(env: Env, extra: Record<string, unknown>) {
  const config = JSON.parse(await env.project.read(".oclite/config.json"))
  await env.project.write(".oclite/config.json", JSON.stringify({ ...config, ...extra }))
}

function envFor(env: Env, extra: Record<string, string> = {}) {
  return { ...isolatedEnv(env.home.path), OCLITE_RETRY_SCALE: "0.001", ...extra }
}

/** A stdio SDK client on a spawned `oclite mcp serve`; `elicit` answers asks (omit it: no elicitation capability). */
async function stdioClient(env: Env, options: { elicit?: (message: string) => string; onMessage?: (data: Out, client: Client) => void; args?: string[]; env?: Record<string, string> } = {}) {
  const client = new Client({ name: "serve-test", version: "1.0.0" }, { capabilities: options.elicit ? { elicitation: {} } : {} })
  if (options.elicit) {
    const elicit = options.elicit
    client.setRequestHandler(ElicitRequestSchema, async (request) => ({ action: "accept", content: { action: elicit(request.params.message) } }))
  }
  client.setNotificationHandler(LoggingMessageNotificationSchema, (notification) => options.onMessage?.(notification.params.data as Out, client))
  const transport = new StdioClientTransport({ command: process.execPath, args: [entry, "mcp", "serve", ...(options.args ?? [])], cwd: env.project.path, env: envFor(env, options.env), stderr: "pipe" })
  await client.connect(transport)
  await client.listTools() // caches outputSchemas, so every structuredContent below is validated by the SDK
  return { client, transport, [Symbol.asyncDispose]: () => client.close() }
}

async function tool(client: Client, name: string, args: Out, options: { timeout?: number; onprogress?: (p: { progress: number }) => void } = {}) {
  const result = await client.callTool({ name, arguments: args }, undefined, { timeout: options.timeout ?? 30_000, onprogress: options.onprogress })
  if (result.isError) throw new Error(JSON.stringify(result.content))
  return result.structuredContent as Out
}

/** A spawned HTTP server; resolves once it printed its URL. */
async function httpServer(env: Env, args: string[] = [], extra: Record<string, string> = { OCLITE_MCP_TOKEN: TOKEN }) {
  const proc = Bun.spawn([process.execPath, entry, ...args, "mcp", "serve", "--transport", "http", "--port", "0"], {
    cwd: env.project.path, env: envFor(env, extra), stdout: "pipe", stderr: "pipe",
  })
  const reader = proc.stderr.getReader()
  const state = { text: "" }
  while (!/\/mcp\n/.test(state.text)) {
    const next = await reader.read()
    if (next.done) break
    state.text += new TextDecoder().decode(next.value)
  }
  reader.releaseLock()
  const url = state.text.match(/http:\/\/[^\s]+\/mcp/)?.[0]
  return { proc, url, stderr: state.text, exited: proc.exited, [Symbol.asyncDispose]: async () => void (proc.kill(), await proc.exited) }
}

async function httpClient(url: string, token = TOKEN) {
  const client = new Client({ name: "http-test", version: "1.0.0" })
  await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }))
  return client
}

const REMOTE = "---\ndescription: Remote helper over MCP\nmode: subagent\ntransport: mcp\n---\nYou are the remote agent."

describe("oclite mcp serve (stdio)", () => {
  test("with elicitation: agent_list, foreground agent_spawn with progress, an ask answered by elicitation", async () => {
    await using env = await setup()
    const asks: string[] = []
    await using mcp = await stdioClient(env, { elicit: (message) => (asks.push(message), "allow") })
    const agents = (await tool(mcp.client, "agent_list", {})).agents as Array<{ name: string }>
    expect(agents.map((agent) => agent.name)).toContain("build")
    env.server.queue(reply.tool_call({ name: "write", args: { filePath: "a.txt", content: "A" } }), reply.text("wrote it"))
    const progress: number[] = []
    const out = await tool(mcp.client, "agent_spawn", { agent: "build", prompt: "write a.txt" }, { onprogress: (p) => progress.push(p.progress) })
    expect(out.state).toBe("completed")
    expect(String(out.envelope)).toMatch(/^<task id="ses_\w+" state="completed">\n<task_result>\nwrote it\n<\/task_result>\n<\/task>$/)
    expect(asks).toHaveLength(1)
    expect(asks[0]).toContain("a.txt")
    expect(await env.project.read("a.txt")).toBe("A")
    expect(progress.length).toBeGreaterThan(0)
    // Prompts (one per primary agent) and redacted session resources.
    expect((await mcp.client.listPrompts()).prompts.map((prompt) => prompt.name)).toContain("build")
    const resources = (await mcp.client.listResources()).resources
    expect(resources[0]?.uri).toBe(`oclite://sessions/${out.id}`)
    const read = await mcp.client.readResource({ uri: resources[0]!.uri })
    expect((read.contents[0] as { text: string }).text).toContain('"type":"session"')
  })

  test("without elicitation: permission_request notification + agent_permission_reply; the timeout denies", async () => {
    await using env = await setup()
    const seen: Out[] = []
    await using mcp = await stdioClient(env, {
      onMessage: (data, client) => {
        if (data.type !== "permission_request") return
        void (async () => {
          seen.push({ ...data, status: await tool(client, "agent_status", { id: data.id }) })
          seen.push(await tool(client, "agent_permission_reply", { id: data.id, request_id: data.request_id, action: "allow" }))
          seen.push(await tool(client, "agent_permission_reply", { id: data.id, request_id: data.request_id, action: "allow" }))
        })()
      },
    })
    env.server.queue(reply.tool_call({ name: "write", args: { filePath: "b.txt", content: "B" } }), reply.text("done b"))
    const out = await tool(mcp.client, "agent_spawn", { agent: "build", prompt: "write b" })
    expect(out.state).toBe("completed")
    expect(await env.project.read("b.txt")).toBe("B")
    expect(seen[0]).toMatchObject({ type: "permission_request", id: out.id, tool: "write", reply_with: "agent_permission_reply" })
    expect((seen[0]!.status as Out).pending_permission).toMatchObject({ request_id: seen[0]!.request_id, tool: "write" })
    expect(seen[1]).toEqual({ ok: true })
    expect(seen[2]).toEqual({ ok: false, error: "expired" })
  })

  test("permission_timeout_ms: an unanswered ask is rejected (via timeout)", async () => {
    await using env = await setup()
    await configure(env, { permission_timeout_ms: 300 })
    await using mcp = await stdioClient(env)
    env.server.queue(reply.tool_call({ name: "write", args: { filePath: "c.txt", content: "C" } }), reply.text("gave up"))
    const out = await tool(mcp.client, "agent_spawn", { agent: "build", prompt: "write c" })
    expect(out.state).toBe("completed")
    expect(await Bun.file(path.join(env.project.path, "c.txt")).exists()).toBe(false)
    const session = await Bun.file(path.join(env.home.path, ".local/share/oclite/sessions", `${out.id}.jsonl`)).text()
    expect(session).toContain('"via":"timeout"')
  })

  test("agent_send steers; agent_status, agent_result (wait false/true, timeout_ms) and agent_cancel", async () => {
    await using env = await setup()
    await configure(env, { permission: { bash: "allow" } })
    await using mcp = await stdioClient(env)
    env.server.queue(reply.tool_call({ name: "bash", args: { command: "sleep 1" } }), reply.text("steered done"))
    const started = await tool(mcp.client, "agent_spawn", { agent: "build", prompt: "work", background: true })
    const run = String(started.id)
    expect(started.state).toBe("running")
    const status = await tool(mcp.client, "agent_status", { id: run })
    expect(status).toMatchObject({ id: run, agent: "build", state: "running" })
    expect(new Date(String(status.started_at)).toISOString()).toBe(status.started_at as string)
    expect(await tool(mcp.client, "agent_send", { id: run, message: "also mention kiwis" })).toEqual({ ok: true, delivery: "steer" })
    expect(await tool(mcp.client, "agent_result", { id: run, wait: false })).toEqual({ id: run, state: "running" })
    expect(await tool(mcp.client, "agent_result", { id: run, timeout_ms: 50 })).toEqual({ id: run, state: "running" })
    const done = await tool(mcp.client, "agent_result", { id: run })
    expect(done.state).toBe("completed")
    expect(String(done.envelope)).toContain("steered done")
    expect(JSON.stringify(env.server.chats()[1]?.body?.messages)).toContain("also mention kiwis")
    expect(await tool(mcp.client, "agent_send", { id: run, message: "late" })).toEqual({ ok: false, delivery: "not_running" })
    expect(await tool(mcp.client, "agent_cancel", { id: run })).toEqual({ status: "already_finished" })
    expect(await tool(mcp.client, "agent_cancel", { id: "ses_nope" })).toEqual({ status: "not_found" })

    env.server.queue(reply.tool_call({ name: "bash", args: { command: "sleep 20" } }))
    const long = String((await tool(mcp.client, "agent_spawn", { agent: "build", prompt: "long", background: true })).id)
    await Bun.sleep(300)
    expect(await tool(mcp.client, "agent_cancel", { id: long })).toEqual({ status: "cancelled" })
    expect((await tool(mcp.client, "agent_result", { id: long })).state).toBe("cancelled")
    const bad = await mcp.client.callTool({ name: "agent_status", arguments: { id: 5 } })
    expect(bad.isError).toBe(true)
  })

  test("stdin EOF cancels runs and exits 0", async () => {
    await using env = await setup()
    await configure(env, { permission: { bash: "allow" } })
    env.server.queue(reply.tool_call({ name: "bash", args: { command: "sleep 20" } }))
    const mcp = await stdioClient(env)
    const run = String((await tool(mcp.client, "agent_spawn", { agent: "build", prompt: "long", background: true })).id)
    await Bun.sleep(300)
    const pid = mcp.transport.pid!
    await mcp.client.close()
    await Bun.sleep(1500)
    expect(alive(pid)).toBe(false)
    const session = await Bun.file(path.join(env.home.path, ".local/share/oclite/sessions", `${run}.jsonl`)).text()
    expect(session).toContain('"reason":"cancelled"')
  })
})

describe("oclite mcp serve (secrets)", () => {
  test("registered secrets never reach notifications/message or session resources", async () => {
    await using env = await setup({ apiKey: "sk-serve-secret-9f8e7d6c" })
    const messages: string[] = []
    await using mcp = await stdioClient(env, { onMessage: (data) => void messages.push(JSON.stringify(data)) })
    env.server.queue(reply.text("the key is sk-serve-secret-9f8e7d6c"))
    const out = await tool(mcp.client, "agent_spawn", { agent: "build", prompt: "leak sk-serve-secret-9f8e7d6c" })
    expect(String(out.envelope)).not.toContain("sk-serve-secret-9f8e7d6c")
    expect(messages.length).toBeGreaterThan(0)
    expect(messages.join("")).not.toContain("sk-serve-secret-9f8e7d6c")
    const read = await mcp.client.readResource({ uri: `oclite://sessions/${out.id}` })
    expect((read.contents[0] as { text: string }).text).not.toContain("sk-serve-secret-9f8e7d6c")
  })
})

describe("oclite mcp serve (http)", () => {
  test("bearer token: none/wrong → 401, right works; loopback bind; missing env token and remote bypass → exit 2", async () => {
    await using env = await setup()
    await using server = await httpServer(env)
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/)
    const init = { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: "{}" }
    expect((await fetch(server.url!, init)).status).toBe(401)
    expect((await fetch(server.url!, { ...init, headers: { ...init.headers, authorization: "Bearer wrong" } })).status).toBe(401)
    expect((await fetch(server.url!, { ...init, headers: { ...init.headers, authorization: `Bearer ${TOKEN}x` } })).status).toBe(401)
    const denied = await fetch(server.url!, { method: "OPTIONS", headers: { origin: "http://evil.example" } })
    expect(denied.headers.get("access-control-allow-origin")).toBeNull()
    const client = await httpClient(server.url!)
    expect(((await client.callTool({ name: "agent_list", arguments: {} })).structuredContent as Out).agents).toBeDefined()
    const bypass = await client.callTool({ name: "agent_spawn", arguments: { agent: "build", prompt: "x", permission_mode: "bypassPermissions" } })
    expect(bypass.isError).toBe(true)
    expect(JSON.stringify(bypass.content)).toContain("a client may only tighten it")
    await client.close()
    const port = new URL(server.url!).port
    const lsof = Bun.spawnSync(["lsof", "-nP", `-iTCP:${port}`, "-sTCP:LISTEN"]).stdout.toString()
    expect(lsof).toContain(`127.0.0.1:${port}`)

    await using missing = await httpServer(env, [], {})
    expect(await missing.exited).toBe(2)
    expect(missing.stderr).toContain("OCLITE_MCP_TOKEN")
    await using remote = await httpServer(env, ["--permission-mode", "bypassPermissions"])
    expect(await remote.exited).toBe(2)
    expect(remote.stderr).toContain("--i-understand-remote-bypass")
  })

  test("a second oclite drives an agent over HTTP with the token (transport: mcp with url)", async () => {
    await using env = await setup()
    await configure(env, { permission: { task: "allow" } })
    // The server needs the agent too; the parent's copy then points at the server's URL.
    await env.project.write(".oclite/agents/remote.md", REMOTE)
    await using server = await httpServer(env)
    await env.project.write(".oclite/agents/remote.md", REMOTE.replace("transport: mcp\n", `transport: mcp\nmcp:\n  url: ${server.url}\n`))
    env.server.queue(
      reply.tool_call({ name: "task", args: { description: "remote job", prompt: "say hi", subagent_type: "remote" } }),
      reply.text("hi from http child"),
      reply.text("parent done"),
    )
    const result = await env.spawn(["-p", "go", "--profile", "default", "--output-format", "json"], { env: { OCLITE_MCP_TOKEN: TOKEN } })
    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout).text).toBe("parent done")
    expect(JSON.stringify(env.server.chats()[2]?.body?.messages)).toContain("hi from http child")
  })
})

describe("transport: mcp children (oclite ↔ oclite over stdio)", () => {
  test("spawn, events relayed with agent_path, envelope back to the parent; no child left after exit", async () => {
    await using env = await setup()
    await configure(env, { permission: { task: "allow" } })
    await env.project.write(".oclite/agents/remote.md", REMOTE)
    env.server.queue(
      reply.tool_call({ name: "task", args: { description: "remote job", prompt: "say hi", subagent_type: "remote" } }),
      reply.text("child says hi"),
      reply.text("parent done"),
    )
    const children: number[] = []
    const result = await env.spawn(["-p", "go", "--profile", "default", "--output-format", "stream-json"], {
      onLine: (_line, proc) => children.push(...pids(proc.pid)),
    })
    expect(result.code).toBe(0)
    const events = result.stdout.trim().split("\n").map((line) => JSON.parse(line) as Out)
    const relayed = events.filter((event) => event.type === "text_delta" && JSON.stringify(event.agent_path) === '["remote"]').map((event) => event.text).join("")
    expect(relayed).toBe("child says hi")
    const envelope = JSON.stringify(env.server.chats()[2]?.body?.messages)
    expect(envelope).toMatch(/<task id=\\"ses_\w+\\" state=\\"completed\\">/)
    expect(envelope).toContain("child says hi")
    expect(children.length).toBeGreaterThan(0)
    expect([...new Set(children)].filter(alive)).toEqual([])
  })

  test("an ask in the child bubbles up to the parent's asker (REPL)", async () => {
    await using env = await setup()
    await configure(env, { permission: { task: "allow" } })
    await env.project.write(".oclite/agents/remote.md", REMOTE)
    env.server.queue(
      reply.tool_call({ name: "task", args: { description: "remote write", prompt: "write child.txt", subagent_type: "remote" } }),
      reply.tool_call({ name: "write", args: { filePath: "child.txt", content: "C" } }),
      reply.text("child wrote"),
      reply.text("ok"),
    )
    const result = await env.spawn(["--profile", "default"], { stdin: "go\ny\n" })
    expect(result.code).toBe(0)
    expect(result.stderr).toContain("[y]es / [a]lways / [n]o")
    expect(result.stderr).toMatch(/permission: .*child\.txt/)
    expect(await env.project.read("child.txt")).toBe("C")
  })

  test("the depth limit holds across processes", async () => {
    await using env = await setup()
    // profile default: the child's own run needs the task tool (opt-in in local profiles).
    await configure(env, { profile: "default", permission: { task: "allow" }, subagent: { max_depth: 1, max_concurrent: 4 } })
    // Children are denied `task` unless their agent allows it (deriveSubagentSessionPermission), in-process or not.
    await env.project.write(".oclite/agents/remote.md", REMOTE.replace("transport: mcp\n", "transport: mcp\npermission:\n  task: allow\n"))
    env.server.queue(
      reply.tool_call({ name: "task", args: { description: "remote job", prompt: "go deeper", subagent_type: "remote" } }),
      reply.tool_call({ name: "task", args: { description: "deeper", prompt: "look", subagent_type: "explore" } }),
      reply.text("could not go deeper"),
      reply.text("parent done"),
    )
    const result = await env.spawn(["-p", "go", "--profile", "default", "--output-format", "json"])
    expect(result.code).toBe(0)
    expect(JSON.stringify(env.server.chats()[2]?.body?.messages)).toContain("Subagent depth limit reached (1)")
    expect(JSON.stringify(env.server.chats()[3]?.body?.messages)).toContain("could not go deeper")
  })

  test("cancel (SIGINT) mid-child: parent exits 130, the child server and its tool process are gone", async () => {
    await using env = await setup()
    await configure(env, { permission: { task: "allow", bash: "allow" } })
    await env.project.write(".oclite/agents/remote.md", REMOTE)
    env.server.queue(
      reply.tool_call({ name: "task", args: { description: "remote sleep", prompt: "sleep", subagent_type: "remote" } }),
      reply.tool_call({ name: "bash", args: { command: "sleep 31" } }),
    )
    const seen = new Set<number>()
    const signalled = { value: false }
    const result = await env.spawn(["-p", "go", "--profile", "default"], {
      onStderr: (text, proc) => {
        pids(proc.pid).forEach((pid) => seen.add(pid))
        if (!signalled.value && text.includes("sleep 31")) {
          signalled.value = true
          setTimeout(() => {
            pids(proc.pid).forEach((pid) => seen.add(pid))
            proc.kill("SIGINT")
          }, 300)
        }
      },
    })
    expect(signalled.value).toBe(true)
    expect(result.code).toBe(130)
    await Bun.sleep(500)
    expect(seen.size).toBeGreaterThan(0)
    expect([...seen].filter(alive)).toEqual([])
    expect(Bun.spawnSync(["pgrep", "-f", "sleep 31"]).stdout.toString().trim()).toBe("")
  }, 30_000)
})

describe("permissions across transport: mcp and agent_spawn", () => {
  const writeChild = [
    reply.tool_call({ name: "task", args: { description: "remote write", prompt: "write it", subagent_type: "remote" } }),
    reply.tool_call({ name: "write", args: { filePath: "pwned.txt", content: "x" } }),
    reply.text("child finished"),
    reply.text("parent done"),
  ]

  test("a plan parent's mcp child can't write, even with a config allow", async () => {
    await using env = await setup()
    await configure(env, { profile: "default", permission: { task: "allow", write: "allow", edit: "allow" } })
    await env.project.write(".oclite/agents/remote.md", REMOTE)
    env.server.queue(...writeChild)
    const result = await env.spawn(["-p", "go", "--permission-mode", "plan", "--output-format", "json"])
    expect(await Bun.file(path.join(env.project.path, "pwned.txt")).exists()).toBe(false)
    expect(JSON.stringify(env.server.chats()[2]?.body?.messages)).toMatch(/permission denied|Unknown tool/)
    expect(result.code).toBe(0)
  })

  test("a parent --disallowed-tools deny reaches the mcp child", async () => {
    await using env = await setup()
    await configure(env, { profile: "default", permission: { task: "allow", write: "allow" } })
    await env.project.write(".oclite/agents/remote.md", REMOTE)
    env.server.queue(...writeChild)
    await env.spawn(["-p", "go", "--disallowed-tools", "write", "--output-format", "json"])
    expect(await Bun.file(path.join(env.project.path, "pwned.txt")).exists()).toBe(false)
    expect(JSON.stringify(env.server.chats()[2]?.body?.messages)).toMatch(/permission denied|Unknown tool/)
  })

  test("a rejected forwarded ask counts as a denial: headless parent exits 3", async () => {
    await using env = await setup()
    await configure(env, { profile: "default", permission: { task: "allow" } })
    await env.project.write(".oclite/agents/remote.md", REMOTE)
    env.server.queue(...writeChild)
    const result = await env.spawn(["-p", "go", "--output-format", "json"])
    expect(await Bun.file(path.join(env.project.path, "pwned.txt")).exists()).toBe(false)
    expect(result.code).toBe(3)
  })

  test("agent_spawn: permission_mode only tightens; cwd stays in the project; parent_id chains keep depth; run cap", async () => {
    await using env = await setup()
    await configure(env, { permission: { bash: "allow" }, subagent: { max_depth: 1, max_concurrent: 4 } })
    await using plan = await stdioClient(env, { args: ["--permission-mode", "plan"] })
    const loosen = await plan.client.callTool({ name: "agent_spawn", arguments: { agent: "build", prompt: "x", permission_mode: "default" } })
    expect(loosen.isError).toBe(true)
    expect(JSON.stringify(loosen.content)).toContain("looser than this server's plan")
    const outside = await plan.client.callTool({ name: "agent_spawn", arguments: { agent: "build", prompt: "x", cwd: "/" } })
    expect(JSON.stringify(outside.content)).toContain("cwd must be an existing directory inside")
    env.server.queue(reply.tool_call({ name: "bash", args: { command: "git status" } }), reply.text("root done"))
    const root = String((await tool(plan.client, "agent_spawn", { agent: "build", prompt: "root", background: true, permission_mode: "plan" })).id)
    env.server.queue(reply.text("child done"))
    const child = String((await tool(plan.client, "agent_spawn", { agent: "explore", prompt: "look", parent_id: root, background: true })).id)
    const chained = await plan.client.callTool({ name: "agent_spawn", arguments: { agent: "explore", prompt: "deeper", parent_id: child, background: true } })
    expect(JSON.stringify(chained.content)).toContain("Subagent depth limit reached (1)")
    expect((await tool(plan.client, "agent_result", { id: child })).state).toBe("completed")
    expect((await tool(plan.client, "agent_result", { id: root })).state).toBe("completed")

    await using capped = await stdioClient(env, { env: { OCLITE_MCP_MAX_RUNS: "1" } })
    env.server.queue(reply.tool_call({ name: "bash", args: { command: "sleep 2" } }), reply.text("slept"))
    await tool(capped.client, "agent_spawn", { agent: "build", prompt: "sleep", background: true })
    const over = await capped.client.callTool({ name: "agent_spawn", arguments: { agent: "build", prompt: "more", background: true } })
    expect(JSON.stringify(over.content)).toContain("too many live runs (1)")
  })
})

describe("Claude Code end to end", () => {
  // README setup line: claude mcp add oclite -- oclite mcp serve
  test.skipIf(process.env.OCLITE_E2E_CLAUDE !== "1")("claude -p drives oclite over stdio (temp --mcp-config, never `claude mcp add`)", async () => {
    console.log("README: claude mcp add oclite -- oclite mcp serve")
    await using env = await setup()
    const file = path.join(env.home.path, "claude-mcp.json")
    await Bun.write(file, JSON.stringify({ mcpServers: { oclite: { command: process.execPath, args: [entry, "mcp", "serve"], env: envFor(env) } } }))
    const proc = Bun.spawn(["claude", "-p", "Call the oclite agent_list tool and print the agent names it returns.", "--mcp-config", file, "--strict-mcp-config",
      "--allowedTools", "mcp__oclite__agent_list"], { cwd: env.project.path, stdout: "pipe", stderr: "pipe" })
    const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited])
    expect(code).toBe(0)
    expect(stdout).toContain("build")
  }, 120_000)
})

/** Direct children of `pid` (and theirs), by `pgrep -P`. */
function pids(pid: number): number[] {
  const direct = Bun.spawnSync(["pgrep", "-P", String(pid)]).stdout.toString().split("\n").filter(Boolean).map(Number)
  return [...direct, ...direct.flatMap(pids)]
}

function alive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
