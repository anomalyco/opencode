// Agent loop against the sanctioned fake server (test/lib/local-server.ts) with the real app layer.
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import path from "path"
import { Cause, Effect, Exit, Fiber } from "effect"
import type { CliArgs } from "../../src/cli/args"
import { load } from "../../src/config/config"
import { ConfigError, Runtime, SessionStore, type RenderEvent, type RunInput } from "../../src/contract"
import { headlessAsker } from "../../src/permission/permission"
import { appLayer } from "../../src/runtime/runtime"
import { reply, startLocalServer, type ChatBody, type LocalServer, type Toggles } from "../lib/local-server"
import { tmpdir } from "../lib/tmp"

const args: CliArgs = {
  outputFormat: "text",
  mcpConfig: [],
  strictMcpConfig: false,
  allowedTools: [],
  disallowedTools: [],
  continue: false,
  noThinking: false,
  trustProject: true,
}

// Probe cache and sessions live under XDG_DATA_HOME; point it at a temp dir for this file.
const data = { dir: "", previous: process.env.XDG_DATA_HOME }
beforeAll(async () => {
  data.dir = (await tmpdir()).path
  process.env.XDG_DATA_HOME = data.dir
})
afterAll(() => {
  process.env.XDG_DATA_HOME = data.previous
})

// Every capability pinned, so resolving the model sends no probe chat requests that would eat scripted replies.
function pins(toggles: Partial<Toggles>, thinkingKnob: boolean) {
  return {
    capabilities: {
      usage_in_stream: true,
      reasoning_field: "reasoning_content",
      think_tags: false,
      tools_native: toggles.tools !== "text",
      prefix_cache: true,
      tokenize: false,
      accepts: { chat_template_kwargs: thinkingKnob, prompt_cache_key: true, reasoning_effort: false, parallel_tool_calls: false },
    },
  }
}

async function setup(
  toggles: Partial<Toggles> = {},
  extra: { files?: Record<string, string>; agent?: string; thinkingKnob?: boolean } = {},
) {
  const server = await startLocalServer(toggles)
  const project = await tmpdir({ git: true, files: extra.files })
  const home = await tmpdir()
  await project.write(
    ".oclite/config.json",
    JSON.stringify({
      model: "local/test-model",
      provider: { local: { npm: "@ai-sdk/openai-compatible", options: { baseURL: server.url }, models: { "test-model": { reasoning: true } } } },
      servers: { [server.url]: pins(toggles, extra.thinkingKnob ?? false) },
    }),
  )
  if (extra.agent) await project.write(".oclite/agents/build.md", extra.agent)
  return {
    server,
    project,
    run: async (
      prompt: string,
      input: Partial<RunInput> = {},
      onEvent: (event: RenderEvent) => void = () => {},
      cancelAfterMs?: number,
    ) => {
      const cfg = await Effect.runPromise(
        load({ ...args, ...input.permissionMode && { permissionMode: input.permissionMode } }, {
          cwd: project.path,
          home: home.path,
          configDir: path.join(home.path, ".config", "oclite"),
        }),
      )
      const events: RenderEvent[] = []
      const sink = (event: RenderEvent) =>
        Effect.sync(() => {
          events.push(event)
          onEvent(event)
        })
      const program = Effect.gen(function* () {
        const runtime = yield* Runtime
        const store = yield* SessionStore
        const handle = yield* runtime.start({ agent: "build", prompt, ...input }, sink)
        if (cancelAfterMs !== undefined) yield* Effect.sleep(cancelAfterMs).pipe(Effect.andThen(handle.cancel), Effect.forkDetach)
        const result = yield* handle.await
        return { result, records: yield* store.read(handle.session_id) }
      })
      const output = await Effect.runPromise(program.pipe(Effect.provide(appLayer(cfg, headlessAsker, undefined, { retryDelays: [5, 10, 20] }))))
      return { ...output, events }
    },
    /** Runs `body` against a freshly built app layer (for handle-level tests). */
    with: async <A>(body: (runtime: Runtime["Service"]) => Effect.Effect<A, unknown>) => {
      const cfg = await Effect.runPromise(
        load(args, { cwd: project.path, home: home.path, configDir: path.join(home.path, ".config", "oclite") }),
      )
      const program = Effect.gen(function* () {
        return yield* body(yield* Runtime)
      })
      return Effect.runPromiseExit(program.pipe(Effect.provide(appLayer(cfg, headlessAsker, undefined, { retryDelays: [5] }))))
    },
    [Symbol.asyncDispose]: async () => {
      await server.stop()
      await project[Symbol.asyncDispose]()
      await home[Symbol.asyncDispose]()
    },
  }
}

const system = (body: ChatBody | undefined) => body?.messages?.find((message) => message.role === "system")?.content
const types = (events: RenderEvent[]) => events.map((event) => event.type)

describe("agent loop (local-server)", () => {
  test("tool call → result → final text, persisted per part", async () => {
    await using env = await setup({}, { files: { "a.txt": "alpha file" } })
    env.server.queue(reply.tool_call({ name: "read", args: { filePath: "a.txt" } }))
    env.server.queue(reply.text("the file says alpha"))
    const out = await env.run("read a.txt")
    expect(out.result).toMatchObject({ state: "completed", reason: "stop", text: "the file says alpha", turns: 2, denied: 0 })
    const chats = env.server.chats()
    expect(chats).toHaveLength(2)
    const toolMessage = chats[1]!.body!.messages!.find((message) => message.role === "tool")
    expect(String(toolMessage?.content)).toContain("alpha file")
    expect(out.records.map((record) => record.type)).toEqual(["session", "user", "tool_call", "step", "permission", "tool_result", "text", "step", "end"])
    expect(out.records.find((record) => record.type === "tool_result")).toMatchObject({ name: "read", status: "ok" })
    expect(types(out.events)).toContain("tool_start")
    expect(out.events.find((event) => event.type === "tool_end")).toMatchObject({ name: "read", status: "ok" })
    expect(out.events.filter((event) => event.type === "step_finish")).toHaveLength(2)
  })

  test("read-only calls run concurrently; mutating calls run one at a time in order", async () => {
    await using env = await setup({}, { files: { "a.txt": "A", "b.txt": "B" } })
    env.server.queue([
      reply.tool_call({ name: "read", args: { filePath: "a.txt" } }),
      reply.tool_call({ name: "read", args: { filePath: "b.txt" } }),
    ])
    env.server.queue([
      reply.tool_call({ name: "write", args: { filePath: "c.txt", content: "C" } }),
      reply.tool_call({ name: "write", args: { filePath: "d.txt", content: "D" } }),
    ])
    env.server.queue(reply.text("done"))
    const out = await env.run("go", { permissionMode: "acceptEdits" })
    expect(out.result.reason).toBe("stop")
    const tools = out.events.flatMap((event) =>
      event.type === "tool_start" || event.type === "tool_end" ? [`${event.type}:${event.name}`] : [],
    )
    expect(tools.slice(0, 4)).toEqual(["tool_start:read", "tool_start:read", "tool_end:read", "tool_end:read"])
    expect(tools.slice(4)).toEqual(["tool_start:write", "tool_end:write", "tool_start:write", "tool_end:write"])
    expect(await env.project.read("d.txt")).toBe("D")
  })

  test("5xx then success emits retry status events", async () => {
    // RequestExecutor retries a status failure twice itself; the third 503 reaches the loop.
    await using env = await setup({ fail_status: { code: 503, times: 3 } })
    env.server.queue(reply.text("recovered"))
    const out = await env.run("hi")
    expect(out.result).toMatchObject({ reason: "stop", text: "recovered" })
    const retries = out.events.filter((event) => event.type === "status" && event.phase === "retry")
    expect(retries.length).toBeGreaterThanOrEqual(1)
    expect(retries[0]).toMatchObject({ attempt: 1, wait_ms: 5 })
  })

  test("stream dropped mid-way, then success; the partial attempt is not replayed", async () => {
    await using env = await setup({ drop_after_chunks: 3 })
    env.server.queue(reply.text("a long answer that will be cut"))
    const out = await env.run("hi", {}, (event) => {
      if (event.type === "status" && event.phase === "retry") env.server.set({ drop_after_chunks: undefined })
    })
    expect(out.result.reason).toBe("stop")
    expect(out.result.text).toBe("a long answer that will be cut")
    expect(env.server.chats().length).toBe(2)
    expect(env.server.chats()[0]!.dropped).toBe(true)
    expect(out.events.some((event) => event.type === "status" && event.phase === "retry")).toBe(true)
    expect(out.records.filter((record) => record.type === "text")).toHaveLength(1)
  })

  test("max turns ends the run with reason max_turns", async () => {
    await using env = await setup({}, { files: { "a.txt": "A" } })
    env.server.queue(reply.tool_call({ name: "read", args: { filePath: "a.txt" } }))
    env.server.queue(reply.tool_call({ name: "read", args: { filePath: "a.txt" } }))
    const out = await env.run("loop", { maxTurns: 1 })
    expect(out.result).toMatchObject({ reason: "max_turns", turns: 1, state: "completed" })
    expect(env.server.chats()).toHaveLength(1)
    expect(out.records.at(-1)).toMatchObject({ type: "end", reason: "max_turns" })
  })

  test("text protocol: parses one call from text, feeds a malformed call back once", async () => {
    await using env = await setup({ tools: "text", text_tool_format: "hermes" }, { files: { "a.txt": "alpha" } })
    env.server.queue(reply.malformed_tool_call("<tool_call>{not json</tool_call>"))
    env.server.queue(reply.text_tool_call({ name: "read", args: { filePath: "a.txt" } }))
    env.server.queue(reply.text("final"))
    const out = await env.run("read a")
    expect(out.result).toMatchObject({ reason: "stop", text: "final" })
    const chats = env.server.chats()
    expect(chats.every((chat) => !chat.body?.tools?.length)).toBe(true)
    expect(String(system(chats[0]!.body))).toContain('{"tool": "<name>"')
    expect(JSON.stringify(chats[1]!.body!.messages)).toContain("Malformed tool call")
    expect(JSON.stringify(chats[2]!.body!.messages)).toContain("alpha")
    expect(chats.every((chat) => !chat.body!.messages!.some((message) => message.role === "tool"))).toBe(true)
  })

  test("text protocol: a second malformed call ends the run with reason error", async () => {
    await using env = await setup({ tools: "text" })
    env.server.queue(reply.malformed_tool_call("<tool_call>{bad</tool_call>"))
    env.server.queue(reply.malformed_tool_call("<tool_call>{still bad</tool_call>"))
    const out = await env.run("x")
    // Headless exit 3 is signalled through `denied` (reason stays "error"; the RunResult union is frozen).
    expect(out.result).toMatchObject({ reason: "error", state: "failed", denied: 1 })
    expect(out.result.error).toContain("malformed tool call")
    expect(env.server.chats()).toHaveLength(2)
  })

  test("first reasoning delta is emitted before the first text delta", async () => {
    await using env = await setup()
    env.server.queue([reply.reasoning("thinking about it"), reply.text("answer")])
    const out = await env.run("q")
    const kinds = types(out.events)
    expect(kinds.indexOf("reasoning_delta")).toBeGreaterThanOrEqual(0)
    expect(kinds.indexOf("reasoning_delta")).toBeLessThan(kinds.indexOf("text_delta"))
    expect(out.records.map((record) => record.type)).toContain("reasoning")
  })

  test("volatile content stays out of the system prompt: system bytes are identical across turns", async () => {
    const agent = "---\nmode: primary\ntools: [todowrite]\n---\nYou are the build agent."
    await using env = await setup({}, { agent, files: { "AGENTS.md": "Project rule: be terse." } })
    const todos = (status: string) => [{ content: "step one", status, priority: "high" }]
    env.server.queue(reply.tool_call({ name: "todowrite", args: { todos: todos("in_progress") } }))
    env.server.queue(reply.tool_call({ name: "todowrite", args: { todos: todos("completed") } }))
    env.server.queue(reply.text("done"))
    const out = await env.run("plan it")
    expect(out.result.reason).toBe("stop")
    const chats = env.server.chats()
    expect(chats).toHaveLength(3)
    const systems = chats.map((chat) => system(chat.body))
    expect(new Set(systems).size).toBe(1)
    expect(String(systems[0])).toContain("Project rule: be terse.")
    expect(String(systems[0])).toMatch(/Today's date: \d{4}-\d{2}-\d{2}\n/)
    expect(String(systems[0])).not.toContain("system-reminder")
    const last = (body: ChatBody | undefined) => JSON.stringify(body?.messages?.at(-1))
    expect(last(chats[1]!.body)).toContain("<system-reminder>")
    expect(last(chats[1]!.body)).toContain("[in_progress] step one")
    expect(last(chats[2]!.body)).toContain("[completed] step one")
    expect(JSON.stringify(chats[2]!.body!.tools)).toBe(JSON.stringify(chats[0]!.body!.tools))
    expect(out.records.filter((record) => record.type === "reminder")).toHaveLength(2)
  })

  test("context overflow 400 → persist the limit, force compaction, retry exactly once", async () => {
    await using env = await setup({ context_limit: 4000 })
    env.server.queue(reply.text("SUMMARY OF WORK"))
    env.server.queue(reply.text("fits now"))
    const out = await env.run("x".repeat(30000))
    expect(out.result).toMatchObject({ reason: "stop", text: "fits now" })
    const chats = env.server.chats()
    expect(chats.map((chat) => chat.status)).toEqual([400, 200, 200])
    expect(String(system(chats[1]!.body))).toContain("context summarization agent")
    expect(JSON.stringify(chats[2]!.body!.messages)).toContain("SUMMARY OF WORK")
    expect(out.records.filter((record) => record.type === "compaction")).toHaveLength(1)
    expect(chats.filter((chat) => String(system(chat.body)).includes("context summarization agent"))).toHaveLength(1)
    const cached = await Array.fromAsync(new Bun.Glob("oclite/servers/*.json").scan({ cwd: data.dir, absolute: true }))
    const records = await Promise.all(cached.map((file) => Bun.file(file).json()))
    expect(records.find((record) => record.base_url === env.server.url)).toMatchObject({
      context_window: 4000,
      sources: { context_window: "error-400" },
    })
  })

  test("overflow is retried exactly once: a second overflow ends the run with an error", async () => {
    await using env = await setup({ context_limit: 4000, delta_chars: 2000 })
    env.server.queue(reply.text("S".repeat(20000))) // a summary still too big for the limit
    const out = await env.run("x".repeat(30000))
    expect(out.result).toMatchObject({ reason: "error", state: "failed" })
    expect(out.result.error).toContain("maximum context length")
    const main = env.server.chats().filter((chat) => !String(system(chat.body)).includes("context summarization agent"))
    expect(main.map((chat) => chat.status)).toEqual([400, 400])
    expect(out.records.filter((record) => record.type === "compaction")).toHaveLength(1)
  })

  test("when the forced compaction itself overflows, the run ends with an error", async () => {
    await using env = await setup({ context_limit: 50 })
    const out = await env.run("hi")
    expect(out.result.reason).toBe("error")
    expect(env.server.chats().map((chat) => chat.status)).toEqual([400, 400])
  })

  test("thinking auto: on for a fresh user prompt, off for tool continuations", async () => {
    await using env = await setup({}, { thinkingKnob: true, files: { "a.txt": "A" } })
    env.server.queue(reply.tool_call({ name: "read", args: { filePath: "a.txt" } }))
    env.server.queue(reply.text("done"))
    await env.run("go")
    const kwargs = env.server.chats().map((chat) => chat.body?.chat_template_kwargs)
    expect(kwargs).toEqual([{ enable_thinking: true }, { enable_thinking: false }])
  })

  test("a thinking turn that ends inside reasoning is retried once with thinking off", async () => {
    await using env = await setup({}, { thinkingKnob: true })
    env.server.queue([reply.reasoning("I keep thinking and never answer"), reply.finish("length")])
    env.server.queue(reply.text("plain answer"))
    const out = await env.run("q")
    expect(out.result).toMatchObject({ reason: "stop", text: "plain answer", turns: 1 })
    const kwargs = env.server.chats().map((chat) => chat.body?.chat_template_kwargs)
    expect(kwargs).toEqual([{ enable_thinking: true }, { enable_thinking: false }])
  })

  test("cancel interrupts the run and records end cancelled", async () => {
    await using env = await setup({ hang: true })
    const out = await env.run("wait", {}, () => {}, 200)
    expect(out.result).toMatchObject({ state: "cancelled", reason: "cancelled" })
    expect(out.records.at(-1)).toMatchObject({ type: "end", reason: "cancelled" })
  })

  test("RunHandle.await still resolves after an earlier waiter was interrupted", async () => {
    await using env = await setup({ chunk_delay_ms: 20 })
    env.server.queue(reply.text("slow answer"))
    const exit = await env.with((runtime) =>
      Effect.gen(function* () {
        const handle = yield* runtime.start({ agent: "build", prompt: "hi" }, () => Effect.void)
        const waiter = yield* handle.await.pipe(Effect.forkChild)
        yield* Fiber.interrupt(waiter)
        return yield* handle.await.pipe(Effect.timeout(5000))
      }),
    )
    expect(Exit.isSuccess(exit) && exit.value).toMatchObject({ state: "completed", text: "slow answer" })
  })

  test("a resume id that is not ses_<alnum> is refused with ConfigError before touching the disk", async () => {
    await using env = await setup()
    for (const bad of ["../..", "ses_../../etc/passwd", "ses_a/b", ""]) {
      const exit = await env.with((runtime) => runtime.start({ agent: "build", prompt: "hi", session_id: bad }, () => Effect.void))
      expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toBeInstanceOf(ConfigError)
    }
    expect(env.server.chats()).toHaveLength(0)
  })
})
