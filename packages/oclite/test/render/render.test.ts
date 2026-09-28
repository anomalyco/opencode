// Progress rendering (SPEC §9, constraint 2): status line latency, per-event render latency, ordering, step tokens,
// stream-json shape (subprocess against local-server), plus the text sink's TTY in-place behaviour (in-process).
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import type { RenderEvent } from "../../src/contract"
import { exitCode } from "../../src/render/event"
import { jsonCollector, streamJsonSink } from "../../src/render/json"
import { textSink } from "../../src/render/text"
import { registerSecret } from "../../src/util/redact"
import { setup } from "../cli/harness"
import { reply } from "../lib/local-server"

const TYPES = ["system", "status", "text_delta", "reasoning_delta", "tool_start", "tool_end", "step_finish", "result", "error"]

describe("render (subprocess)", () => {
  test("status line reaches stderr within 300 ms of spawn", async () => {
    await using env = await setup()
    // Best of three: the first spawn in a test run also pays for Bun's module cache warm-up.
    const runs = [await env.spawn(["-p", "hi"]), await env.spawn(["-p", "hi"]), await env.spawn(["-p", "hi"])]
    const best = Math.min(...runs.map((run) => run.firstStderrMs ?? Infinity))
    console.log(`PERF status line: ${runs.map((run) => run.firstStderrMs).join(" / ")} ms (best ${best})`)
    runs.forEach((run) => expect(run.stderr.startsWith("loading config\n")).toBe(true))
    expect(best).toBeLessThan(300)
  })

  test("stream-json: each delta is rendered < 50 ms after the server sent it; every line parses", async () => {
    await using env = await setup({ toggles: { chunk_delay_ms: 40, delta_chars: 4 } })
    env.server.queue([reply.reasoning("thinking hard"), reply.text("the quick brown fox jumps over")])
    const result = await env.spawn(["-p", "go", "--output-format", "stream-json"])
    expect(result.code).toBe(0)
    const events = result.lines.map((item) => ({ at: item.at, event: JSON.parse(item.line) as RenderEvent }))
    events.forEach((item) => expect(TYPES).toContain(item.event.type))
    const sent = env.server.chats()[0]!.chunks.flatMap((chunk) => {
      const delta = (chunk.data as { choices?: Array<{ delta?: { content?: string; reasoning_content?: string } }> })?.choices?.[0]?.delta
      return delta?.content || delta?.reasoning_content ? [chunk.at] : []
    })
    const deltas = events.filter((item) => item.event.type === "text_delta" || item.event.type === "reasoning_delta")
    expect(deltas).toHaveLength(sent.length)
    const latency = deltas.map((item, i) => item.at - sent[i]!)
    console.log(`PERF render latency: max ${Math.max(...latency)} ms, mean ${(latency.reduce((a, b) => a + b, 0) / latency.length).toFixed(1)} ms over ${latency.length} deltas`)
    expect(Math.max(...latency)).toBeLessThan(50)
    const kinds = events.map((item) => item.event.type)
    expect(kinds.indexOf("reasoning_delta")).toBeLessThan(kinds.indexOf("text_delta"))
    expect(kinds.at(-1)).toBe("result")
  })

  test("text mode: reasoning reaches stderr before text reaches stdout; step tokens on stderr", async () => {
    await using env = await setup({ toggles: { chunk_delay_ms: 30 } })
    env.server.queue([reply.reasoning("hmm"), reply.text("answer")])
    const marks = { reasoning: 0, text: 0 }
    const result = await env.spawn(["-p", "go"], {
      onStderr: (text) => void (marks.reasoning ||= text.includes("hmm") ? Date.now() : 0),
      onLine: () => void (marks.text ||= Date.now()),
    })
    expect(result.code).toBe(0)
    expect(result.stdout).toBe("answer\n")
    expect(result.stderr).toContain("hmm")
    expect(result.stderr).toMatch(/^step 1 · in \d+ \/ out \d+ tok$/m)
    expect(marks.reasoning).toBeGreaterThan(0)
    expect(marks.reasoning).toBeLessThan(marks.text)
  })

  test("usage_in_stream=false: step tokens are labelled est.", async () => {
    await using env = await setup({ toggles: { usage_in_stream: false }, pins: { usage_in_stream: false } })
    env.server.queue(reply.text("ok"))
    const result = await env.spawn(["-p", "go"])
    expect(result.code).toBe(0)
    expect(result.stderr).toMatch(/^step 1 · in \d+ \/ out \d+ tok \(est\.\)$/m)
    expect(result.stderr).toContain("token counts: estimated")
  })

  test("--no-thinking hides reasoning in text mode", async () => {
    await using env = await setup()
    env.server.queue([reply.reasoning("secret musing"), reply.text("visible")])
    const result = await env.spawn(["-p", "go", "--no-thinking"])
    expect(result.code).toBe(0)
    expect(result.stdout).toBe("visible\n")
    expect(result.stderr).not.toContain("secret musing")
  })
})

describe("text sink (in-process)", () => {
  const base = { session_id: "ses_1", agent_path: [] }
  function render(events: RenderEvent[], options: { tty: boolean; showThinking?: boolean }) {
    const out: string[] = []
    const err: string[] = []
    const sink = textSink({ showThinking: options.showThinking ?? true, tty: options.tty, color: false, out: (s) => void out.push(s), err: (s) => void err.push(s) })
    Effect.runSync(Effect.forEach(events, sink))
    return { out: out.join(""), err: err.join("") }
  }
  const tool = (call_id: string, summary: string): RenderEvent[] => [
    { ...base, type: "tool_start", call_id, name: "read", summary },
    { ...base, type: "tool_end", call_id, name: "read", summary, status: "ok", duration_ms: 12, bytes: 3482 },
  ]

  test("TTY: status and tool lines are rewritten in place", () => {
    const result = render(
      [{ ...base, type: "status", phase: "config", message: "loading config" }, { ...base, type: "status", phase: "tools", message: "building tools" }, ...tool("c1", "read src/x.ts")],
      { tty: true },
    )
    expect(result.err).toBe("\r\x1b[Kloading config\r\x1b[K\r\x1b[Kbuilding tools\r\x1b[K⚙ read src/x.ts\r\x1b[K✓ read src/x.ts · 12 ms · 3.4 KB\n")
    expect(result.out).toBe("")
  })

  test("non-TTY: plain lines; text segments separated; sub-agent output indented on stderr", () => {
    const result = render(
      [
        { ...base, type: "status", phase: "config", message: "loading config" },
        { ...base, type: "text_delta", text: "Looking" },
        ...tool("c1", "read a"),
        { ...base, agent_path: ["explore"], type: "text_delta", text: "child\nsays" },
        { ...base, type: "text_delta", text: "Done" },
        { ...base, type: "step_finish", step: 2, usage: { input: 812, output: 64, estimated: true } },
        { ...base, type: "tool_end", call_id: "c9", name: "bash", summary: "bash rm", status: "denied", duration_ms: 1, bytes: 40 },
      ],
      { tty: false },
    )
    expect(result.out).toBe("Looking\nDone\n")
    expect(result.err).toBe(
      "loading config\n⚙ read a\n✓ read a · 12 ms · 3.4 KB\n  child\n  says\nstep 2 · in 812 / out 64 tok (est.)\n✗ bash rm · denied · 1 ms · 40 B\n",
    )
  })

  test("showThinking=false drops reasoning; reasoning ends its line before text", () => {
    const events: RenderEvent[] = [{ ...base, type: "reasoning_delta", text: "hm" }, { ...base, type: "text_delta", text: "hi" }]
    expect(render(events, { tty: false, showThinking: false })).toEqual({ out: "hi", err: "" })
    expect(render(events, { tty: false })).toEqual({ out: "hi", err: "hm\n" })
  })

  test("every sink redacts registered secrets and credentialed URLs", () => {
    registerSecret("sk-live-SECRET123")
    const events: RenderEvent[] = [
      { ...base, type: "error", message: "cannot reach http://user:hunter22pass@host/v1?api_key=QQQ999key (key sk-live-SECRET123)", retryable: false },
      { ...base, type: "status", phase: "retry", message: "retrying sk-live-SECRET123", attempt: 1, wait_ms: 2 },
      { ...base, type: "result", state: "failed", text: "sk-live-SECRET123", turns: 0, usage: { input: 0, output: 0, estimated: true }, exit_code: 1 },
    ]
    const lines: string[] = []
    const collector = jsonCollector()
    Effect.runSync(Effect.forEach(events, (event) => Effect.andThen(collector.sink(event), streamJsonSink((line) => void lines.push(line))(event))))
    const text = render(events, { tty: false })
    const all = [lines.join(""), JSON.stringify(collector.result()), text.out, text.err].join("\n")
    ;["hunter22pass", "QQQ999key", "sk-live-SECRET123"].forEach((secret) => expect(all).not.toContain(secret))
    expect(text.err).toContain("cannot reach http://")
    expect(text.err).toContain("host/v1")
  })

  test("exit codes: text-protocol give-up (failed, denied 1) → 3 headless; plain failure → 1; cancel → 130", () => {
    const run = { session_id: "s", text: "", turns: 1, usage: { input: 0, output: 0, estimated: false }, denied: 0 }
    expect(exitCode({ ...run, state: "failed", reason: "error", denied: 1, error: "malformed twice" }, true)).toBe(3)
    expect(exitCode({ ...run, state: "failed", reason: "error" }, true)).toBe(1)
    expect(exitCode({ ...run, state: "completed", reason: "max_turns" }, true)).toBe(3)
    expect(exitCode({ ...run, state: "completed", reason: "stop", denied: 2 }, false)).toBe(0)
    expect(exitCode({ ...run, state: "cancelled", reason: "cancelled" }, true)).toBe(130)
  })

  test("json collector keeps the result; stream-json writes one line per event", () => {
    const lines: string[] = []
    const collector = jsonCollector()
    const events: RenderEvent[] = [
      { ...base, type: "error", message: "boom", retryable: false },
      { ...base, type: "result", state: "failed", text: "", turns: 1, usage: { input: 1, output: 1, estimated: false }, exit_code: 1 },
    ]
    Effect.runSync(Effect.forEach(events, (event) => Effect.andThen(collector.sink(event), streamJsonSink((line) => void lines.push(line))(event))))
    expect(collector.result()).toMatchObject({ type: "result", exit_code: 1, errors: ["boom"] })
    expect(lines.map((line) => JSON.parse(line).type)).toEqual(["error", "result"])
  })
})
