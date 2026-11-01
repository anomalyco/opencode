import { expect, test } from "bun:test"
import { mkdtemp, readdir, stat, readFile, mkdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  createRequestDiagnostic,
  REQUEST_DIAGNOSTIC_HEADER,
  RequestDiagnostic,
} from "../../src/provider/request-diagnostic.js"
import { EMPTY_VETTING_LOOP_MESSAGE, DSML_GUARD_MESSAGE } from "../../src/session/llm/dsml.js"

const provenance = { provider: "llmgw", model: "dsv4", sessionID: "test-session", messageID: "test-message" }
const guard = { type: "provider-error", message: DSML_GUARD_MESSAGE }
const response = (id = "0123456789abcdef") => new Response("", { headers: { "x-llmgw-request-id": id } })
const tick = async () => {
  for (const index of Array.from({ length: 100 })) {
    void index
    await Promise.resolve()
  }
}
const init = (token: string, body: RequestInit["body"] = '{ "messages":[],"tools":[],"return_token_ids":true }') => ({
  body,
  headers: { [REQUEST_DIAGNOSTIC_HEADER]: token, authorization: "Bearer NEVER_PERSIST" },
})

test("default is fixed disabled and strips arbitrary internal header without capture", () => {
  expect(RequestDiagnostic.notice).toBe("disabled")
  const d = createRequestDiagnostic({ enabled: false })
  expect(d.notice).toBe("disabled")
  expect(d.begin(provenance)).toBeUndefined()
  const prepared = d.prepare(init("unknown"))
  expect(new Headers(prepared.init.headers).has(REQUEST_DIAGNOSTIC_HEADER)).toBe(false)
  expect(new Headers(prepared.init.headers).get("authorization")).toBe("Bearer NEVER_PERSIST")
  expect(d.stats().bytes).toBe(0)
})

test("scope excludes other providers and model aliases", () => {
  const d = createRequestDiagnostic({ enabled: true })
  expect(d.begin({ ...provenance, provider: "other" })).toBeUndefined()
  expect(d.begin({ ...provenance, model: "dsv4c" })).toBeUndefined()
  expect(d.stats().handles).toBe(0)
})

test("exact serialized tools and options remain byte-identical, request ID paired, no headers in candidate", async () => {
  const captured: unknown[] = []
  const d = createRequestDiagnostic({
    enabled: true,
    writer: async (value) => {
      captured.push(value)
    },
  })
  const h = d.begin(provenance)!
  const body =
    '{ "tools":[{"function":{"name":"bash","parameters":{"description":"雪"}}}], "messages":[], "temperature":0.3 }\n'
  const p = d.prepare(init(h.token, body))
  expect(p.init.body).toBe(body)
  expect(new Headers(p.init.headers).has(REQUEST_DIAGNOSTIC_HEADER)).toBe(false)
  p.settle(response())
  h.trigger(guard)
  h.close()
  await tick()
  const candidate = captured[0] as { body: Buffer; requestID: string }
  expect(candidate.body.equals(Buffer.from(body))).toBe(true)
  expect(candidate.requestID).toBe("0123456789abcdef")
  expect(Object.keys(candidate)).not.toContain("headers")
  expect(Object.keys(candidate)).not.toContain("authorization")
  expect(d.stats().bytes).toBe(0)
})

test("normal completion, cancellation and unrelated errors write nothing and release memory", async () => {
  const captured: unknown[] = []
  const d = createRequestDiagnostic({
    enabled: true,
    writer: async (value) => {
      captured.push(value)
    },
  })
  for (const event of [
    undefined,
    { type: "provider-error", message: "other" },
    { type: "text-delta", message: DSML_GUARD_MESSAGE },
  ]) {
    const h = d.begin(provenance)!
    d.prepare(init(h.token)).settle(response())
    if (event) h.trigger(event)
    h.close()
  }
  await tick()
  expect(captured).toHaveLength(0)
  expect(d.stats().slots).toBe(0)
  expect(d.stats().bytes).toBe(0)
})

test("concurrent streams never cross-pair and completed failed attempt is replaced by retry", async () => {
  const captured: Array<{ body: Buffer; requestID: string; attempt: number }> = []
  const d = createRequestDiagnostic({
    enabled: true,
    writer: async (value) => {
      captured.push(value)
    },
  })
  const a = d.begin(provenance)!,
    b = d.begin({ ...provenance, sessionID: "second" })!
  d.prepare(init(a.token, "old")).settle()
  const pa = d.prepare(init(a.token, "retry")),
    pb = d.prepare(init(b.token, "second"))
  pb.settle(response("1111111111111111"))
  pa.settle(response("2222222222222222"))
  a.trigger(guard)
  b.trigger(guard)
  a.close()
  b.close()
  await tick()
  expect(captured.map((x) => [x.body.toString(), x.requestID, x.attempt])).toEqual([
    ["retry", "2222222222222222", 2],
    ["second", "1111111111111111", 1],
  ])
})

test("overlapping retries and missing/invalid response identity safely skip", async () => {
  const captured: unknown[] = []
  const d = createRequestDiagnostic({
    enabled: true,
    writer: async (value) => {
      captured.push(value)
    },
  })
  const h = d.begin(provenance)!
  const first = d.prepare(init(h.token))
  const second = d.prepare(init(h.token))
  first.settle(response())
  second.settle(response())
  h.trigger(guard)
  expect(h.status()).toBe("ambiguous")
  h.close()
  const missing = d.begin(provenance)!
  d.prepare(init(missing.token)).settle(response("invalid"))
  missing.trigger(guard)
  missing.close()
  await tick()
  expect(captured).toHaveLength(0)
  expect(d.stats().bytes).toBe(0)
})

test("eight handles and exact-body limit; unsupported and full paths still strip header", () => {
  const d = createRequestDiagnostic({ enabled: true })
  const handles = Array.from({ length: 8 }, () => d.begin(provenance)!)
  expect(d.begin(provenance)).toBeUndefined()
  const full = d.prepare(init("unknown"))
  expect(new Headers(full.init.headers).has(REQUEST_DIAGNOSTIC_HEADER)).toBe(false)
  const tooLarge = d.prepare(init(handles[0].token, "x".repeat(16 * 1024 * 1024 + 1)))
  expect(new Headers(tooLarge.init.headers).has(REQUEST_DIAGNOSTIC_HEADER)).toBe(false)
  expect(handles[0].status()).toBe("capacity")
  d.prepare(init(handles[1].token, new Uint8Array([1])))
  expect(handles[1].status()).toBe("unsupported_body")
  handles.forEach((h) => h.close())
  expect(d.stats().slots).toBe(0)
})

test("stalled persistence cannot delay original guard, queue remains memory charged", async () => {
  const pending: { resolve?: () => void } = {}
  const d = createRequestDiagnostic({
    enabled: true,
    writer: () =>
      new Promise<void>((resolve) => {
        pending.resolve = resolve
      }),
  })
  const h = d.begin(provenance)!
  d.prepare(init(h.token, "exact-body")).settle(response())
  const before = performance.now()
  h.trigger(guard)
  expect(guard).toEqual({ type: "provider-error", message: DSML_GUARD_MESSAGE })
  expect(performance.now() - before).toBeLessThan(100)
  h.trigger(guard)
  h.close()
  await tick()
  expect(d.stats().bytes).toBe(10)
  expect(d.stats().slots).toBe(1)
  pending.resolve!()
  await tick()
  expect(d.stats().bytes).toBe(0)
})

test("private immutable persistence uses exact bytes and bounded metadata without auth", async () => {
  const parent = await mkdtemp(path.join(tmpdir(), "opencode-request-diag-"))
  const directory = path.join(parent, "private")
  const d = createRequestDiagnostic({ enabled: true, directory })
  const h = d.begin(provenance)!
  const body = '{"messages":[{"content":"private test"}], "tools": []}\n'
  d.prepare(init(h.token, body)).settle(response())
  h.trigger(guard)
  h.close()
  for (const index of Array.from({ length: 100 })) {
    void index
    if (!d.stats().running) break
    await Bun.sleep(5)
  }
  const files = await readdir(directory)
  const json = files.find((name) => name.endsWith(".json"))!
  expect(json).toBeDefined()
  const metadata = JSON.parse(await readFile(path.join(directory, json), "utf8"))
  expect(metadata.exactness).toBe("client-serialized-request-before-gateway-rewrites")
  expect(metadata.sensitivity).toContain("full request prompts and tool definitions")
  expect(metadata.gateway_request_id).toBe("0123456789abcdef")
  expect(await readFile(path.join(directory, metadata.body_file), "utf8")).toBe(body)
  expect((await stat(directory)).mode & 0o777).toBe(0o700)
  for (const name of files) expect((await stat(path.join(directory, name))).mode & 0o777).toBe(0o600)
  expect(JSON.stringify(metadata)).not.toContain("NEVER_PERSIST")
  expect(d.stats().bytes).toBe(0)
})

test("disk reservation ceiling and nonprivate directory refuse capture without changing guard", async () => {
  for (const full of [true, false]) {
    const directory = await mkdtemp(path.join(tmpdir(), "opencode-request-refusal-"))
    if (full)
      for (const index of Array.from({ length: 32 }, (_, index) => index)) {
        await writeFile(path.join(directory, `slot-${String(index).padStart(2, "0")}`), "", { mode: 0o600 })
      }
    if (!full) await mkdir(path.join(directory, "unexpected"))
    const d = createRequestDiagnostic({ enabled: true, directory })
    const h = d.begin(provenance)!
    d.prepare(init(h.token)).settle(response())
    h.trigger(guard)
    h.close()
    for (const index of Array.from({ length: 100 })) {
      void index
      if (!d.stats().running) break
      await Bun.sleep(5)
    }
    expect((await readdir(directory)).some((name) => name.endsWith(".body"))).toBe(false)
    expect(d.stats().bytes).toBe(0)
  }
})

test("completed writers do not allow more than eight still-open handles", async () => {
  const d = createRequestDiagnostic({ enabled: true, writer: async () => {} })
  const handles = Array.from({ length: 8 }, () => d.begin(provenance)!)
  for (const h of handles) {
    d.prepare(init(h.token)).settle(response())
    h.trigger(guard)
  }
  await tick()
  expect(d.stats().slots).toBe(0)
  expect(d.begin(provenance)).toBeUndefined()
  handles.forEach((h) => h.close())
  expect(d.begin(provenance)).toBeDefined()
})

test("Request-carried internal headers strip under disabled and unsupported branches", () => {
  for (const enabled of [false, true]) {
    const d = createRequestDiagnostic({ enabled })
    const h = d.begin(provenance)
    const request = new Request("http://invalid.test", {
      method: "POST",
      body: "opaque",
      headers: { [REQUEST_DIAGNOSTIC_HEADER]: h?.token ?? "unknown", authorization: "Bearer keep-on-network" },
    })
    const p = d.prepare({}, request)
    expect(new Headers(p.init.headers).has(REQUEST_DIAGNOSTIC_HEADER)).toBe(false)
    expect(new Headers(p.init.headers).get("authorization")).toBe("Bearer keep-on-network")
    expect(p.init.body).toBeUndefined()
    if (h) {
      expect(h.status()).toBe("unsupported_body")
      h.close()
    }
  }
})

test("existing allowed-name orphan body refuses capture; persisted metadata declares sensitivity", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "opencode-request-orphan-"))
  await writeFile(path.join(directory, "deadbeef.body"), "unreserved", { mode: 0o600 })
  const d = createRequestDiagnostic({ enabled: true, directory })
  const h = d.begin(provenance)!
  d.prepare(init(h.token)).settle(response())
  h.trigger(guard)
  h.close()
  for (const index of Array.from({ length: 100 })) {
    void index
    if (!d.stats().running) break
    await Bun.sleep(5)
  }
  expect(await readdir(directory)).toEqual(["deadbeef.body"])
  expect(d.stats().bytes).toBe(0)
})

test("second successful response permanently makes handle ambiguous, never pairs first guard to retry", async () => {
  const captured: unknown[] = []
  const d = createRequestDiagnostic({
    enabled: true,
    writer: async (value) => {
      captured.push(value)
    },
  })
  const h = d.begin(provenance)!
  d.prepare(init(h.token, "first")).settle(response("1111111111111111"))
  d.prepare(init(h.token, "second")).settle(response("2222222222222222"))
  h.trigger(guard)
  expect(captured).toHaveLength(0)
  d.prepare(init(h.token, "third")).settle(response("3333333333333333"))
  h.trigger(guard)
  h.close()
  await tick()
  expect(captured).toHaveLength(0)
  expect(d.stats().bytes).toBe(0)
})

test("pending-overlap ambiguity remains terminal after a guard and third attempt", async () => {
  const captured: unknown[] = []
  const d = createRequestDiagnostic({
    enabled: true,
    writer: async (value) => {
      captured.push(value)
    },
  })
  const h = d.begin(provenance)!
  const first = d.prepare(init(h.token, "first"))
  d.prepare(init(h.token, "overlap")).settle(response())
  first.settle(response())
  h.trigger(guard)
  expect(h.status()).toBe("ambiguous")
  d.prepare(init(h.token, "third")).settle(response())
  h.trigger(guard)
  h.close()
  await tick()
  expect(captured).toHaveLength(0)
  expect(d.stats().bytes).toBe(0)
})

test("unpaired metadata and invalid reservation files refuse capture conservatively", async () => {
  for (const [name, content] of [
    ["deadbeef.json", "{}"],
    ["slot-00", "nonempty"],
    ["slot-99", ""],
  ]) {
    const directory = await mkdtemp(path.join(tmpdir(), "opencode-request-reservations-"))
    await writeFile(path.join(directory, name), content, { mode: 0o600 })
    const d = createRequestDiagnostic({ enabled: true, directory })
    const h = d.begin(provenance)!
    d.prepare(init(h.token)).settle(response())
    h.trigger(guard)
    h.close()
    for (const index of Array.from({ length: 100 })) {
      void index
      if (!d.stats().running) break
      await Bun.sleep(5)
    }
    expect(await readdir(directory)).toEqual([name])
    expect(d.stats().bytes).toBe(0)
  }
})

test("exact fixed loop error correlates diagnostics without broadening unrelated errors", async () => {
  const captured: unknown[] = []
  const d = createRequestDiagnostic({ enabled: true, writer: async (value) => { captured.push(value) } })
  for (const message of [EMPTY_VETTING_LOOP_MESSAGE, EMPTY_VETTING_LOOP_MESSAGE + " unrelated"]) {
    const h = d.begin(provenance)!
    d.prepare(init(h.token)).settle(response())
    h.trigger({ type: "provider-error", message })
    h.close()
  }
  await tick()
  expect(captured).toHaveLength(1)
  expect(d.stats().bytes).toBe(0)
  expect(RequestDiagnostic.notice).toBe("disabled")
})

test("prepareRequest strips the internal header and captures the exact body", async () => {
  const captured: Array<{ body: Buffer; requestID: string }> = []
  const d = createRequestDiagnostic({ enabled: true, writer: async (value) => { captured.push(value) } })
  const h = d.begin(provenance)!
  const body = '{"messages":[],"tools":[]}'
  const request = new Request("http://invalid.test/v1/chat/completions", {
    method: "POST",
    body,
    headers: { [REQUEST_DIAGNOSTIC_HEADER]: h.token, authorization: "Bearer NEVER_PERSIST" },
  })
  const prepared = await d.prepareRequest(request)
  expect(prepared.request.headers.has(REQUEST_DIAGNOSTIC_HEADER)).toBe(false)
  expect(prepared.request.headers.get("authorization")).toBe("Bearer NEVER_PERSIST")
  prepared.settle(response())
  d.trigger(h.token, guard)
  d.close(h.token)
  await tick()
  expect(captured).toHaveLength(1)
  expect(captured[0].body.toString()).toBe(body)
  expect(captured[0].requestID).toBe("0123456789abcdef")
})
