// Phase 4 (ARCHITECTURE §14): the MCP client end to end, against the SPAWNED fixture server (test/fixture/mcp-everything.ts)
// and the sanctioned model fake (test/lib/local-server.ts). Every run is a real `bun src/index.ts` subprocess.
import { describe, expect, test } from "bun:test"
import { readdirSync } from "fs"
import path from "path"
import { setup } from "../cli/harness"
import { reply, type ChatBody } from "../lib/local-server"
import { sanitize, wireName } from "../../src/mcp/tools"

const fixture = path.resolve(import.meta.dir, "../fixture/mcp-everything.ts")

type Env = Awaited<ReturnType<typeof setup>>

/** Adds MCP servers to the project config the harness wrote. `fixture` is the stdio fixture unless overridden. */
async function withMcp(env: Env, servers: Record<string, unknown> = {}, fixtureExtra: Record<string, unknown> = {}) {
  const config = JSON.parse(await env.project.read(".oclite/config.json"))
  config.mcp = { fixture: { type: "local", command: [process.execPath, fixture], ...fixtureExtra }, ...servers }
  await env.project.write(".oclite/config.json", JSON.stringify(config))
}

const toolNames = (body: ChatBody | undefined) => (body?.tools ?? []).map((tool) => (tool as { function: { name: string } }).function.name)
const toolDef = (body: ChatBody | undefined, name: string) =>
  (body?.tools ?? []).map((tool) => (tool as { function: { name: string; description: string } }).function).find((fn) => fn.name === name)
const systemOf = (body: ChatBody | undefined) => String(body?.messages?.find((item) => item.role === "system")?.content ?? "")
const events = (stdout: string) => stdout.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>)

describe("mcp naming", () => {
  test("sanitizes each part and applies the 64-char rule", () => {
    expect(wireName("fixture", "echo")).toBe("mcp__fixture__echo")
    expect(wireName("my.server", "do thing/now")).toBe("mcp__my_server__do_thing_now")
    expect(sanitize("a:b@c")).toBe("a_b_c")
    const long = wireName("a-very-long-server-name-for-testing", "and_an_even_longer_tool_name_that_overflows")
    expect(long).toHaveLength(64)
    const full = "mcp__a-very-long-server-name-for-testing__and_an_even_longer_tool_name_that_overflows"
    expect(long.slice(0, 56)).toBe(`${full.slice(0, 55)}_`)
    expect(long.slice(56)).toBe(new Bun.CryptoHasher("sha1").update(full).digest("hex").slice(0, 8))
    // Names that share the first 55 chars still differ.
    expect(wireName("a-very-long-server-name-for-testing", "and_an_even_longer_tool_name_that_overflows_2")).not.toBe(long)
    expect(wireName("s", "x".repeat(57))).toHaveLength(64)
    expect(wireName("s", "x".repeat(56))).toBe(`mcp__s__${"x".repeat(56)}`)
  })
})

describe("mcp client (spawned fixture)", () => {
  test("-p: the model calls mcp__fixture__echo; the result reaches the next request and the output; no orphan", async () => {
    await using env = await setup()
    const pidFile = path.join(env.project.path, "fixture.pid")
    // `exec` keeps the pid, so the file names the fixture process itself.
    await withMcp(env, {}, { command: ["sh", "-c", `echo $$ > "${pidFile}"; exec "${process.execPath}" "${fixture}"`] })
    env.server.queue(reply.tool_call({ name: "mcp__fixture__echo", args: { text: "hello-mcp" } }), reply.text("echoed hello-mcp"))
    const result = await env.spawn(["-p", "echo it", "--profile", "default", "--allowed-tools", "mcp__fixture__*", "--output-format", "json"])
    expect(result.code).toBe(0)
    const [first, second] = env.server.chats().map((chat) => chat.body)
    expect(toolDef(first, "mcp__fixture__echo")?.description).toBe("[fixture] Echo the given text back")
    expect(toolNames(first)).toContain("mcp__fixture__write_file")
    // Server instructions: once, in the system prompt, because the fixture's tools are in the request.
    expect(systemOf(first).match(/Instructions from MCP server fixture/g)).toHaveLength(1)
    expect(systemOf(second)).toBe(systemOf(first))
    expect(JSON.stringify(second?.messages)).toContain("hello-mcp")
    expect(JSON.parse(result.stdout)).toMatchObject({ type: "result", text: "echoed hello-mcp", exit_code: 0 })
    const pid = Number(await Bun.file(pidFile).text())
    expect(pid).toBeGreaterThan(0)
    expect(alive(pid)).toBe(false)
  })

  test("REPL: /mcp__fixture__greet name=Bob sends the prompt text; @fixture:fixture://readme is attached", async () => {
    await using env = await setup()
    await withMcp(env)
    env.server.queue(reply.text("hi Bob"), reply.text("read it"), reply.text("big one"))
    const big = `fixture://item/${"x".repeat(9000)}`
    const result = await env.spawn([], { stdin: `/mcp\n/mcp__fixture__greet name=Bob\nsummarize @fixture:fixture://readme\nlook @fixture:${big}\n` })
    expect(result.code).toBe(0)
    expect(result.stdout).toContain("fixture: connected (6 tools)")
    expect(result.stdout).toContain("/mcp__fixture__greet name=…")
    const chats = env.server.chats().map((chat) => JSON.stringify(chat.body?.messages))
    expect(chats[0]).toContain("Please greet Bob warmly.")
    expect(chats[1]).toContain("summarize @fixture:fixture://readme")
    expect(chats[1]).toContain("This is the mcp-everything fixture readme.")
    // Over 8 KB: written to a file under tool-output and attached by path.
    expect(chats[2]).toContain("Too large to inline")
    const saved = chats[2]!.match(/path=\\"([^\\]+)\\"/)?.[1]
    expect(saved).toBeDefined()
    expect(await Bun.file(saved!).text()).toContain(`item ${"x".repeat(9000)}`)
    expect(chats[2]).not.toContain(`item ${"x".repeat(9000)}`)
  })

  test("deferred (local): only tool_search is sent; the activated schema joins the next request and survives resume", async () => {
    await using env = await setup()
    await withMcp(env)
    env.server.queue(reply.tool_call({ name: "tool_search", args: { query: "echo" } }), reply.text("found it"))
    const result = await env.spawn(["-p", "find echo", "--profile", "local", "--output-format", "json"])
    expect(result.code).toBe(0)
    const [first, second] = env.server.chats().map((chat) => chat.body)
    expect(toolNames(first)).toEqual(["bash", "edit", "glob", "grep", "read", "tool_search", "write"])
    expect(toolNames(second)).toContain("mcp__fixture__echo")
    expect(toolNames(second)).not.toContain("mcp__fixture__add")
    // The system prompt stays byte-stable; the server's instructions arrive in the tool_search result instead.
    expect(systemOf(second)).toBe(systemOf(first))
    expect(systemOf(first)).not.toContain("Instructions from MCP server")
    const toolResult = JSON.stringify(second?.messages)
    expect(toolResult).toContain("mcp__fixture__echo — [fixture] Echo the given text back")
    expect(toolResult).toContain("Instructions from MCP server fixture")
    const session = JSON.parse(result.stdout).session_id as string
    const records = await Bun.file(path.join(env.home.path, ".local/share/oclite/sessions", `${session}.jsonl`)).text()
    expect(records).toContain('"type":"tools_activated"')

    env.server.queue(reply.text("resumed"))
    const resumed = await env.spawn(["-p", "again", "--resume", session, "--profile", "local", "--output-format", "json"])
    expect(resumed.code).toBe(0)
    expect(toolNames(env.server.chats()[2]?.body)).toContain("mcp__fixture__echo")
  })

  test("timeouts: slow past the server timeout is a tool error; progress resets the timeout", async () => {
    await using env = await setup()
    await withMcp(env, {}, { timeout: 1500 })
    env.server.queue(
      reply.tool_call({ name: "mcp__fixture__slow", args: { steps: 1, ms: 2500 } }),
      reply.tool_call({ name: "mcp__fixture__slow", args: { steps: 6, ms: 400 } }),
      reply.text("done"),
    )
    const result = await env.spawn(["-p", "go slow", "--profile", "default", "--allowed-tools", "mcp__fixture__*", "--output-format", "stream-json"])
    expect(result.code).toBe(0)
    const ends = events(result.stdout).filter((event) => event.type === "tool_end")
    expect(ends.map((event) => event.status)).toEqual(["timeout", "ok"])
    const chats = env.server.chats().map((chat) => JSON.stringify(chat.body?.messages))
    expect(chats[1]).toContain("timed out after 1.5 s")
    expect(chats[2]).toContain("done after 6 steps")
  }, 30_000)

  test("crash mid-call: a tool error result, the run continues, /mcp shows failed, /reconnect recovers", async () => {
    await using env = await setup()
    await withMcp(env)
    env.server.queue(reply.tool_call({ name: "mcp__fixture__crash", args: {} }), reply.text("it crashed"))
    const result = await env.spawn(["--profile", "default", "--allowed-tools", "mcp__fixture__*"], { stdin: "crash it\n/mcp\n/reconnect\n" })
    expect(result.code).toBe(0)
    expect(result.stdout).toContain("it crashed")
    expect(result.stderr).toMatch(/✗ mcp__fixture__crash/)
    expect(JSON.stringify(env.server.chats()[1]?.body?.messages)).toMatch(/MCP error: .*[Cc]onnection closed/)
    expect(result.stdout).toMatch(/fixture: failed — connection closed/)
    expect(result.stdout.split("fixture: failed").at(-1)).toContain("fixture: connected (6 tools)")
  })

  test("list_changed: a tool added by the server appears on the next run", async () => {
    await using env = await setup()
    await withMcp(env, {}, { environment: { FIXTURE_LIST_CHANGED: "1" } })
    env.server.queue(reply.text("one"), reply.text("two"))
    const result = await env.spawn(["--profile", "default"], { stdin: "one\n/mcp\ntwo\n" })
    expect(result.code).toBe(0)
    expect(result.stdout).toContain("fixture: connected (7 tools)")
    expect(toolNames(env.server.chats()[1]?.body)).toContain("mcp__fixture__late")
  })

  test("read_only agent: may call mcp__fixture__lookup (readOnlyHint), never mcp__fixture__write_file", async () => {
    await using env = await setup()
    // A real write dir, so a write_file that got through would leave pwned.txt behind.
    await withMcp(env, {}, { environment: { FIXTURE_WRITE_DIR: env.project.path } })
    env.server.queue(
      reply.tool_call({ name: "mcp__fixture__lookup", args: { key: "alpha" } }),
      reply.tool_call({ name: "mcp__fixture__write_file", args: { path: "pwned.txt", content: "x" } }),
      reply.text("done"),
    )
    const result = await env.spawn(["-p", "look", "--agent", "plan", "--profile", "default", "--allowed-tools", "mcp__fixture__*", "--output-format", "stream-json"])
    const first = env.server.chats()[0]?.body
    expect(toolNames(first)).toContain("mcp__fixture__lookup")
    expect(toolNames(first)).not.toContain("mcp__fixture__write_file")
    const ends = events(result.stdout).filter((event) => event.type === "tool_end")
    expect(ends.map((event) => [event.name, event.status])).toEqual([["mcp__fixture__lookup", "ok"], ["mcp__fixture__write_file", "error"]])
    expect(JSON.stringify(env.server.chats()[1]?.body?.messages)).toContain('"1"')
    expect(await Bun.file(path.join(env.project.path, "pwned.txt")).exists()).toBe(false)
  })

  test("secrets: MCP header values never reach JSONL, stream-json or stderr", async () => {
    const secret = "hdr-secret-4f9a2c7e11"
    const seen: string[] = []
    const remote = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: (req) => (seen.push(req.headers.get("x-api-key") ?? ""), new Response("nope", { status: 500 })) })
    await using env = await setup()
    const plain = "plain-env-value-5566"
    await withMcp(env, { remote: { type: "remote", url: `http://127.0.0.1:${remote.port}/mcp`, headers: { "X-Api-Key": secret }, oauth: false } }, { environment: { FIXTURE_PLAIN: plain } })
    env.server.queue(reply.tool_call({ name: "mcp__fixture__echo", args: { text: `key ${secret} ${plain}` } }), reply.text(`the key is ${secret} ${plain}`))
    const result = await env.spawn(["-p", "leak it", "--profile", "default", "--allowed-tools", "mcp__fixture__*", "--output-format", "stream-json"])
    remote.stop(true)
    expect(result.code).toBe(0)
    expect(seen).toContain(secret)
    expect(result.stdout).toContain("mcp remote: failed")
    expect(result.stdout).toContain("***")
    // Every stdio env value (not only secret-named keys) counts as a secret.
    for (const value of [secret, plain]) {
      expect(result.stdout).not.toContain(value)
      expect(result.stderr).not.toContain(value)
    }
    const dir = path.join(env.home.path, ".local/share/oclite/sessions")
    const jsonl = await Promise.all(readdirSync(dir).map((file) => Bun.file(path.join(dir, file)).text()))
    expect(jsonl.join("")).toContain("***")
    expect(jsonl.join("")).not.toContain(secret)
    expect(jsonl.join("")).not.toContain(plain)
  })

  test("server instructions are capped per profile (default 2000 in the system prompt, local 600 in tool_search), with one notice", async () => {
    await using env = await setup()
    const long = "Always double-check. ".repeat(300)
    await withMcp(env, {}, { environment: { FIXTURE_INSTRUCTIONS: long } })
    env.server.queue(reply.text("ok"))
    const first = await env.spawn(["-p", "hi", "--profile", "default"])
    expect(first.code).toBe(0)
    expect(first.stderr).toContain("Instructions from MCP server fixture cut to 2000 chars (default)")
    const system = systemOf(env.server.chats()[0]?.body)
    const block = system.slice(system.indexOf("Instructions from MCP server fixture:"))
    expect(block).toContain("…[truncated]")
    expect(block.indexOf("…[truncated]")).toBe(2000 + 1)
    expect(system).not.toContain(long.trim())

    env.server.queue(reply.tool_call({ name: "tool_search", args: { query: "echo" } }), reply.text("found"))
    const local = await env.spawn(["-p", "find", "--profile", "local"])
    expect(local.code).toBe(0)
    expect(local.stderr).toContain("cut to 600 chars (local)")
    const result = JSON.stringify(env.server.chats()[2]?.body?.messages)
    expect(result).toContain("…[truncated]")
    expect(result).not.toContain("Always double-check. ".repeat(40))
  })

  test("name collisions: the first server in config order keeps the wire name; the duplicate is skipped with a notice", async () => {
    await using env = await setup()
    const long = "a-server-name-that-is-longer-than-forty-chars"
    await withMcp(env, { "fix.a": { type: "local", command: [process.execPath, fixture] }, fix_a: { type: "local", command: [process.execPath, fixture] }, [long]: { type: "local", command: [process.execPath, fixture] } })
    const list = await env.spawn(["mcp", "list", "--check"])
    expect(list.code).toBe(0)
    expect(list.stdout).toContain("skipped fix_a/echo: mcp__fix_a__echo is already fix.a/echo")
    expect(list.stdout).not.toContain("skipped fix.a/")
    expect(list.stdout).toContain(`server name over 40 chars: hashed tool names may not match mcp__${long}__* globs`)
    env.server.queue(reply.text("ok"))
    expect((await env.spawn(["-p", "hi", "--profile", "default"])).code).toBe(0)
    const names = toolNames(env.server.chats()[0]?.body)
    expect(names.filter((name) => name === "mcp__fix_a__echo")).toHaveLength(1)
    expect(toolDef(env.server.chats()[0]?.body, "mcp__fix_a__echo")?.description).toBe("[fix.a] Echo the given text back")
  })

  test("REPL always: one approval covers later calls of the same MCP tool only", async () => {
    await using env = await setup()
    await withMcp(env)
    env.server.queue(
      reply.tool_call({ name: "mcp__fixture__echo", args: { text: "one" } }),
      reply.tool_call({ name: "mcp__fixture__echo", args: { text: "two" } }),
      reply.tool_call({ name: "mcp__fixture__add", args: { a: 1, b: 2 } }),
      reply.text("done"),
    )
    const result = await env.spawn(["--profile", "default"], { stdin: "go\na\nn\n" })
    expect(result.code).toBe(0)
    expect(result.stderr.match(/\[y\]es \/ \[a\]lways \/ \[n\]o/g)).toHaveLength(2)
    expect(result.stderr).toMatch(/✗ mcp__fixture__add.*denied/)
    expect(JSON.stringify(env.server.chats()[2]?.body?.messages)).toContain("two")
  })

  test.each<[string, number]>([["local", 1200], ["local-min", 600]])("budget: %s with an MCP server stays within %d tok", async (profile, budget) => {
    await using env = await setup({ pins: { reasoning_field: "none" } })
    await withMcp(env)
    const result = await env.spawn(["debug", "prompt", "--tokens", "--check", "--profile", profile, "--output-format", "json"])
    if (result.code !== 0) console.log(result.stdout, result.stderr)
    expect(result.code).toBe(0)
    const report = JSON.parse(result.stdout) as { fixed: number; estimated: boolean; tools: Array<{ name: string }> }
    console.log(`PERF ${profile} + MCP: fixed=${report.fixed} tok`)
    expect(report.tools.map((tool) => tool.name)).toContain("tool_search")
    expect(report.tools.some((tool) => tool.name.startsWith("mcp__"))).toBe(false)
    expect(report.estimated).toBe(false)
    expect(report.fixed).toBeLessThanOrEqual(budget)
  })

  test("mcp list --check shows live status; mcp auth refuses a stdio server", async () => {
    await using env = await setup()
    await withMcp(env)
    const list = await env.spawn(["mcp", "list", "--check"])
    expect(list.code).toBe(0)
    expect(list.stdout).toMatch(/^fixture: .*\(local\) · connected \(6 tools\)$/m)
    const auth = await env.spawn(["mcp", "auth", "fixture"])
    expect(auth.code).toBe(2)
    expect(auth.stderr).toContain("not a configured remote MCP server")
  })
})

function alive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
