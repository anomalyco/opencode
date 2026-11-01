import { expect, test } from "bun:test"
import type { JSONSchema7, LanguageModelV3StreamPart } from "@ai-sdk/provider"
import type { DSMLRecoveryAuditInput } from "../../src/provider/dsml-recovery-audit.js"
import { guardStatus, isDSV4Scope, recoverDSMLStream, recoveryStatus } from "../../src/session/llm/dsml-recovery.js"

const schema: JSONSchema7 = {
  type: "object",
  properties: { command: { type: "string" } },
  required: ["command"],
  additionalProperties: false,
}
const params = {
  tools: [{ type: "function" as const, name: "bash", inputSchema: schema }],
  toolChoice: { type: "auto" as const },
}
const options: {
  params: Pick<import("@ai-sdk/provider").LanguageModelV3CallOptions, "tools" | "toolChoice">
  sessionID: string
  messageID: string
  onSuspect?: () => void
  audit: (input: DSMLRecoveryAuditInput) => void
} = {
  params,
  sessionID: "ses_fixture",
  messageID: "msg_fixture",
  audit: (_input: DSMLRecoveryAuditInput) => {},
}
const call =
  '<｜DSML｜invoke name="bash"><｜DSML｜parameter name="command" string="true"> harmless fixture </｜DSML｜parameter></｜DSML｜invoke>'
const end: LanguageModelV3StreamPart = {
  type: "finish",
  finishReason: { unified: "stop", raw: "stop" },
  usage: {
    inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 1, text: 1, reasoning: 0 },
  },
}
function source(parts: LanguageModelV3StreamPart[]) {
  return new ReadableStream<LanguageModelV3StreamPart>({
    start(c) {
      for (const p of parts) c.enqueue(p)
      c.close()
    },
  })
}
async function read(parts: LanguageModelV3StreamPart[], extra: Partial<typeof options> = {}) {
  const reader = recoverDSMLStream(source(parts), { ...options, ...extra }).getReader()
  const result: LanguageModelV3StreamPart[] = []
  while (true) {
    const next = await reader.read()
    if (next.done) return result
    result.push(next.value)
  }
}
function deltas(text: string, size = text.length): LanguageModelV3StreamPart[] {
  const out: LanguageModelV3StreamPart[] = [{ type: "text-start", id: "text" }]
  for (let i = 0; i < text.length; i += size)
    out.push({ type: "text-delta", id: "text", delta: text.slice(i, i + size) })
  return [...out, { type: "text-end", id: "text" }, end]
}

test("exact scope and fixed default disabled status", () => {
  expect(isDSV4Scope("llmgw", "dsv4")).toBe(true)
  for (const [p, m] of [
    ["llmgw", "dsv4c"],
    ["other", "dsv4"],
    ["llmgw", "local-fast"],
  ])
    expect(isDSV4Scope(p, m)).toBe(false)
  const previous = process.env.OPENCODE_DSV4_RECOVERY_ENABLED
  try {
    for (const [value, expected] of [
      [undefined, "disabled"],
      ["0", "disabled"],
      ["true", "disabled"],
      ["1", "enabled"],
    ] as const) {
      if (value === undefined) delete process.env.OPENCODE_DSV4_RECOVERY_ENABLED
      else process.env.OPENCODE_DSV4_RECOVERY_ENABLED = value
      expect(recoveryStatus()).toBe(expected)
    }
    // The strict guard is the default; only an explicit `0` turns it off.
    for (const [value, expected] of [
      [undefined, "enabled"],
      ["0", "disabled"],
      ["true", "enabled"],
      ["1", "enabled"],
    ] as const) {
      if (value === undefined) delete process.env.OPENCODE_DSV4_RECOVERY_ENABLED
      else process.env.OPENCODE_DSV4_RECOVERY_ENABLED = value
      expect(guardStatus()).toBe(expected)
    }
  } finally {
    if (previous === undefined) delete process.env.OPENCODE_DSV4_RECOVERY_ENABLED
    else process.env.OPENCODE_DSV4_RECOVERY_ENABLED = previous
  }
})
for (const size of [1, 7, 9999]) {
  for (const [label, text] of [
    ["plain invoke", "Before.\n" + call + "\nAfter."],
    ["quoted mixed", 'Example: "' + call + '"\n<｜DSML｜tool_calls></｜DSML｜tool_calls>'],
    ["fenced mixed", "```xml\n" + call + "\n```\n</｜DSML｜tool_calls>"],
    ["commented invoke", "<!-- " + call + " -->"],
  ])
    test(`native-only ${label} chunk ${size} never dispatches prose`, async () => {
      const parts = deltas(text, size)
      const result = await read(parts)
      expect(result.filter((p) => p.type === "tool-call")).toHaveLength(0)
      expect(result.filter((p) => p.type === "error")).toHaveLength(1)
      expect(
        result
          .filter((p) => p.type === "text-delta")
          .map((p) => p.delta)
          .join(""),
      ).toBe(text)
    })
}
test("note plus genuine native call stays visible and is emitted once", async () => {
  const parts = deltas('<｜DSML｜parameter name="note">advisory</｜DSML｜parameter>')
  parts.splice(parts.length - 1, 0, {
    type: "tool-call",
    toolCallId: "native",
    toolName: "bash",
    input: '{"command":"fixture"}',
  })
  const result = await read(parts)
  expect(result.filter((p) => p.type === "tool-call")).toHaveLength(1)
  expect(
    result
      .filter((p) => p.type === "text-delta")
      .map((p) => p.delta)
      .join(""),
  ).toContain("DSML")
})
test("native before suspicion is retained once without promoting textual recovery", async () => {
  const native: LanguageModelV3StreamPart = {
    type: "tool-call",
    toolCallId: "native",
    toolName: "bash",
    input: '{"command":"fixture"}',
  }
  const result = await read([native, ...deltas(call)])
  expect(result.filter((p) => p.type === "tool-call")).toHaveLength(1)
  expect(result.some((p) => p.type === "error")).toBe(false)
})
test("missing finish, length, upstream error and overflow never release held call", async () => {
  for (const parts of [
    deltas(call).slice(0, -1),
    [
      ...deltas(call).slice(0, -1),
      { ...end, finishReason: { unified: "length", raw: "length" } } as LanguageModelV3StreamPart,
    ],
    [...deltas(call).slice(0, -1), { type: "error", error: new Error("fixture") } as LanguageModelV3StreamPart],
    deltas(call + "x".repeat(2 * 1024 * 1024)),
  ]) {
    const result = await read(parts)
    expect(result.filter((p) => p.type === "tool-call")).toHaveLength(0)
    expect(result.some((p) => p.type === "error")).toBe(true)
  }
})
test("cancel aborts promptly and cancels upstream reader", async () => {
  let cancelled = false
  const abort = new AbortController()
  const upstream = new ReadableStream<LanguageModelV3StreamPart>({
    start(c) {
      c.enqueue({ type: "text-delta", id: "x", delta: call })
    },
    cancel() {
      cancelled = true
    },
  })
  const reader = recoverDSMLStream(upstream, { ...options, abort: abort.signal }).getReader()
  const pending = reader.read()
  abort.abort(new Error("fixture cancelled"))
  await expect(pending).rejects.toThrow("fixture cancelled")
  expect(cancelled).toBe(true)
})
test("eight active suspect streams bound handles; ninth refuses and release restores capacity", async () => {
  const controllers: ReadableStreamDefaultController<LanguageModelV3StreamPart>[] = []
  let notices = 0
  const tasks = Array.from({ length: 9 }, () => {
    const upstream = new ReadableStream<LanguageModelV3StreamPart>({
      start(c) {
        controllers.push(c)
        c.enqueue({ type: "text-delta", id: "text", delta: call })
        c.enqueue({ type: "tool-call", toolCallId: "native", toolName: "bash", input: '{"command":"fixture"}' })
      },
    })
    const reader = recoverDSMLStream(upstream, {
      ...options,
      onSuspect: () => {
        notices++
      },
    }).getReader()
    return (async () => {
      const parts: LanguageModelV3StreamPart[] = []
      while (true) {
        const next = await reader.read()
        if (next.done) return parts
        parts.push(next.value)
      }
    })()
  })
  const ninth = await tasks[8]
  expect(notices).toBe(9)
  expect(ninth.filter((p) => p.type === "error")).toHaveLength(1)
  expect(ninth.filter((p) => p.type === "tool-call")).toHaveLength(0)
  for (const controller of controllers.slice(0, 8)) {
    controller.enqueue(end)
    controller.close()
  }
  const valid = await Promise.all(tasks.slice(0, 8))
  expect(valid.every((parts) => parts.filter((p) => p.type === "tool-call").length === 1)).toBe(true)
  const again = await read(nativeParts(call, 7))
  expect(again.filter((p) => p.type === "tool-call")).toHaveLength(1)
})
test("native before note is not replayed; undeclared prior native cannot justify preservation", async () => {
  const note = '<｜DSML｜parameter name="note">advisory</｜DSML｜parameter>'
  const native: LanguageModelV3StreamPart = {
    type: "tool-call",
    toolCallId: "native",
    toolName: "bash",
    input: '{"command":"fixture"}',
  }
  const good = await read([native, ...deltas(note)])
  expect(good.filter((p) => p.type === "tool-call")).toHaveLength(1)
  expect(good.some((p) => p.type === "error")).toBe(false)
  const bad = await read([{ ...native, toolName: "unknown" }, ...deltas(note)])
  expect(bad.filter((p) => p.type === "tool-call")).toHaveLength(1)
  expect(bad.some((p) => p.type === "error")).toBe(true)
})
test("response overflow is fixed rejection and audits once", async () => {
  const audits: DSMLRecoveryAuditInput[] = []
  const result = await read(deltas('<｜DSML｜invoke name="bash">' + "x".repeat(2 * 1024 * 1024)), {
    audit: (value) => {
      audits.push(value)
    },
  })
  expect(result.filter((p) => p.type === "tool-call")).toHaveLength(0)
  expect(audits).toHaveLength(1)
  expect(audits[0]).toMatchObject({ disposition: "overflow", reason: "response_limit", recoveredCount: 0 })
})
test("Markdown shorter fence and nonwhitespace closing suffix stay protected across chunks", async () => {
  for (const value of [
    "````xml\nexample\n```\n" + call + "\n````",
    "```xml\n```not-a-close\n" + call + "\n```",
    "Example: '" + call + "'",
    "Example: ``" + call + "``",
  ])
    for (const size of [1, 7, 9999]) {
      const result = await read(deltas(value, size))
      expect(result.filter((p) => p.type === "tool-call")).toHaveLength(0)
      expect(result.some((p) => p.type === "error")).toBe(false)
      expect(
        result
          .filter((p) => p.type === "text-delta")
          .map((p) => p.delta)
          .join(""),
      ).toBe(value)
    }
})
test("prior native proof retention rejects oversized IDs only when suspicious protocol follows", async () => {
  const native: LanguageModelV3StreamPart = {
    type: "tool-call",
    toolCallId: "x".repeat(129),
    toolName: "bash",
    input: '{"command":"fixture"}',
  }
  const normal = await read([native, end])
  expect(normal.filter((p) => p.type === "tool-call")).toHaveLength(1)
  expect(normal.some((p) => p.type === "error")).toBe(false)
  const suspect = await read([native, ...deltas('<｜DSML｜parameter name="note">advisory</｜DSML｜parameter>')])
  expect(suspect.filter((p) => p.type === "tool-call")).toHaveLength(1)
  expect(suspect.some((p) => p.type === "error")).toBe(true)
})
test("prior native arguments are not copied or revalidated for subsequent malformed text", async () => {
  const native: LanguageModelV3StreamPart = {
    type: "tool-call",
    toolCallId: "native-large",
    toolName: "bash",
    input: JSON.stringify({ command: "x".repeat(1024 * 1024 + 1) }),
  }
  const normal = await read([native, end])
  expect(normal.filter((p) => p.type === "tool-call")).toEqual([native])
  expect(normal.some((p) => p.type === "error")).toBe(false)
  const suspect = await read([native, ...deltas('<｜DSML｜parameter name="note">advisory</｜DSML｜parameter>')])
  expect(suspect.filter((p) => p.type === "tool-call")).toEqual([native])
  expect(suspect.some((p) => p.type === "error")).toBe(false)
})
test("ordinary upstream rejection before suspicion preserves original error and performs no audit", async () => {
  const original = new Error("ordinary fixture transport failure")
  const audits: unknown[] = []
  const upstream = new ReadableStream<LanguageModelV3StreamPart>({
    pull() {
      throw original
    },
  })
  const reader = recoverDSMLStream(upstream, { ...options, audit: (input) => audits.push(input) }).getReader()
  await expect(reader.read()).rejects.toBe(original)
  expect(audits).toHaveLength(0)
})

const malformedNativeText =
  'Before.\n<vetting>\n<parameter name="host">synthetic</｜DSML｜parameter>\n</vetting>\nAfter.'
const genuineNative: LanguageModelV3StreamPart = {
  type: "tool-call",
  toolCallId: "api-native",
  toolName: "bash",
  input: '{"command":"harmless fixture"}',
}
const nativeEnd: LanguageModelV3StreamPart = { ...end, finishReason: { unified: "tool-calls", raw: "tool_calls" } }
function nativeParts(value: string, size: number) {
  return [...deltas(value, size).slice(0, -1), genuineNative, nativeEnd]
}
for (const size of [9999, 1, 7]) {
  test(`native API calls survive malformed companion text exactly once through chunk ${size}`, async () => {
    const audits: DSMLRecoveryAuditInput[] = []
    const parts = nativeParts(malformedNativeText, size)
    const result = await read(parts, { audit: (input) => audits.push(input) })
    expect(result.filter((p) => p.type === "tool-call")).toEqual([genuineNative])
    expect(
      result
        .filter((p) => p.type === "text-delta")
        .map((p) => p.delta)
        .join(""),
    ).toBe(malformedNativeText)
    expect(result.find((p) => p.type === "finish")).toEqual(nativeEnd)
    expect(result.some((p) => p.type === "error")).toBe(false)
    expect(audits).toHaveLength(1)
    expect(audits[0]).toMatchObject({
      disposition: "rejected",
      reason: "native_preserved",
      recoveredCount: 0,
      nativeCount: 1,
    })
  })
}
test("native calls before and after textual invoke are never replayed or promoted", async () => {
  for (const parts of [[genuineNative, ...deltas(call)], nativeParts(call, 7)]) {
    const result = await read(parts)
    expect(result.filter((p) => p.type === "tool-call")).toEqual([genuineNative])
    expect(result.some((p) => p.type === "error")).toBe(false)
  }
})
test("quoted native companion text stays ordinary with no protocol audit", async () => {
  const value = `Example: \`${call}\``
  const audits: DSMLRecoveryAuditInput[] = []
  const result = await read(nativeParts(value, 1), { audit: (input) => audits.push(input) })
  expect(result.filter((p) => p.type === "tool-call")).toEqual([genuineNative])
  expect(
    result
      .filter((p) => p.type === "text-delta")
      .map((p) => p.delta)
      .join(""),
  ).toBe(value)
  expect(audits).toHaveLength(0)
})
test("missing invalid undeclared partial or truncated native evidence never executes target", async () => {
  const variants: LanguageModelV3StreamPart[][] = [
    deltas(malformedNativeText),
    [...deltas(malformedNativeText).slice(0, -1), { ...genuineNative, toolName: "unknown" }, nativeEnd],
    [
      ...deltas(malformedNativeText).slice(0, -1),
      { type: "tool-input-start", id: "partial", toolName: "bash" },
      nativeEnd,
    ],
    [
      ...nativeParts(malformedNativeText, 7).slice(0, -1),
      { ...nativeEnd, finishReason: { unified: "length", raw: "length" } },
    ],
    nativeParts(malformedNativeText, 7).slice(0, -1),
    [
      ...deltas(malformedNativeText).slice(0, -1),
      genuineNative,
      { type: "tool-input-start", id: "unfinished-other", toolName: "bash" },
      nativeEnd,
    ],
    [...deltas(malformedNativeText).slice(0, -1), genuineNative, { type: "error", error: new Error("fixture") }],
  ]
  for (const parts of variants) {
    const result = await read(parts)
    expect(result.filter((p) => p.type === "tool-call")).toHaveLength(0)
    expect(result.some((p) => p.type === "error")).toBe(true)
  }
  const result = await read(nativeParts(malformedNativeText, 7), {
    params: { ...params, toolChoice: { type: "none" } },
  })
  expect(result.filter((p) => p.type === "tool-call")).toHaveLength(0)
  expect(result.some((p) => p.type === "error")).toBe(true)
})

const emptyLoop = "<vetting></vetting>\n".repeat(16)
test("single and fifteen empty blocks preserve native calls once", async () => {
  for (const count of [1, 15]) {
    const result = await read(nativeParts("<vetting></vetting>\n".repeat(count), 1))
    expect(result.filter((p) => p.type === "tool-call")).toHaveLength(1)
    expect(result.some((p) => p.type === "error")).toBe(false)
  }
})
test("plain empty loop aborts before later native calls", async () => {
  for (const size of [1, 7, emptyLoop.length]) {
    const result = await read(nativeParts(emptyLoop, size))
    expect(result.filter((p) => p.type === "tool-call")).toHaveLength(0)
    expect(result.some((p) => p.type === "error")).toBe(true)
  }
})
test("prior released native remains exactly once; held native remains zero", async () => {
  const released = await read([genuineNative, ...deltas(emptyLoop)])
  expect(released.filter((p) => p.type === "tool-call")).toHaveLength(1)
  expect(released.some((p) => p.type === "error")).toBe(true)
  const held = await read([...deltas(malformedNativeText).slice(0, -1), genuineNative, ...deltas(emptyLoop)])
  expect(held.filter((p) => p.type === "tool-call")).toHaveLength(0)
  expect(held.some((p) => p.type === "error")).toBe(true)
})
test("quoted loop examples preserve text and native execution", async () => {
  for (const text of [
    "'" + emptyLoop.replaceAll("\n", "") + "'",
    "````xml\n```\n" + emptyLoop.replaceAll("\n", "") + "````\n",
    "> " + emptyLoop.replaceAll("\n", "\n> "),
  ]) {
    const result = await read(nativeParts(text, 1))
    expect(result.filter((p) => p.type === "tool-call")).toHaveLength(1)
    expect(result.some((p) => p.type === "error")).toBe(false)
  }
})
test("empty loop cancels upstream promptly and emits fixed metadata without tool promotion", async () => {
  let cancelled = false
  const records: DSMLRecoveryAuditInput[] = []
  const upstream = new ReadableStream<LanguageModelV3StreamPart>({
    start(controller) {
      controller.enqueue({ type: "text-start", id: "loop" })
      controller.enqueue({ type: "text-delta", id: "loop", delta: emptyLoop })
    },
    cancel() {
      cancelled = true
    },
  })
  const reader = recoverDSMLStream(upstream, { ...options, audit: (record) => records.push(record) }).getReader()
  const parts: LanguageModelV3StreamPart[] = []
  while (true) {
    const next = await reader.read()
    if (next.done) break
    parts.push(next.value)
  }
  expect(cancelled).toBe(true)
  expect(parts.filter((part) => part.type === "tool-call")).toHaveLength(0)
  expect(parts.filter((part) => part.type === "error")).toHaveLength(1)
  expect(records).toMatchObject([
    { reason: "empty_vetting_loop", disposition: "rejected", nativeCount: 0, recoveredCount: 0 },
  ])
})
test("assignment and attribute quoted loops preserve native calls once", async () => {
  for (const text of [
    'example="' + emptyLoop.replaceAll("\n", "") + '"',
    "example='" + emptyLoop.replaceAll("\n", "") + "'",
    '<sample value="' + emptyLoop.replaceAll("\n", "") + '">',
    'punctuation,"' + emptyLoop.replaceAll("\n", "") + '"',
    "<sample value='" + emptyLoop.replaceAll("\n", "") + "'>",
  ]) {
    for (const size of [1, 7, text.length]) {
      const result = await read(nativeParts(text, size))
      expect(result.filter((p) => p.type === "tool-call")).toHaveLength(1)
      expect(result.some((p) => p.type === "error")).toBe(false)
    }
  }
  const result = await read(nativeParts("don't mistake prose for a quote. " + emptyLoop, 1))
  expect(result.filter((p) => p.type === "tool-call")).toHaveLength(0)
  expect(result.some((p) => p.type === "error")).toBe(true)
})
test("single-quote operator literals preserve native once; apostrophe prose still aborts", async () => {
  for (const prefix of ["prefix+", "prefix-", "prefix/", "prefix|", "prefix&", "prefix.", "prefix?"]) {
    const text = prefix + "'" + emptyLoop.replaceAll("\n", "") + "'"
    for (const size of [1, 7, text.length]) {
      const result = await read(nativeParts(text, size))
      expect(result.filter((p) => p.type === "tool-call")).toHaveLength(1)
      expect(result.some((p) => p.type === "error")).toBe(false)
    }
  }
  for (const text of ["don't", "I'll", "élève's"]) {
    const result = await read(nativeParts(text + " " + emptyLoop, 1))
    expect(result.filter((p) => p.type === "tool-call")).toHaveLength(0)
    expect(result.some((p) => p.type === "error")).toBe(true)
  }
})
test("name and tool-choice restrictions hold without inspecting argument schemas", async () => {
  for (const choice of [{ type: "none" } as const, { type: "tool", toolName: "other" } as const]) {
    const result = await read(nativeParts(malformedNativeText, 1), { params: { ...params, toolChoice: choice } })
    expect(result.filter((p) => p.type === "tool-call")).toHaveLength(0)
    expect(result.filter((p) => p.type === "error")).toHaveLength(1)
  }
  for (const choice of [{ type: "required" } as const, { type: "tool", toolName: "bash" } as const]) {
    const result = await read(nativeParts(malformedNativeText, 1), { params: { ...params, toolChoice: choice } })
    expect(result.filter((p) => p.type === "tool-call")).toEqual([genuineNative])
    expect(result.filter((p) => p.type === "error")).toHaveLength(0)
  }
})
test("duplicate held native IDs and quoted text with incomplete native input refuse", async () => {
  for (const parts of [
    [...nativeParts(malformedNativeText, 7).slice(0, -1), genuineNative, nativeEnd],
    [
      ...deltas("Example: `" + call + "`").slice(0, -1),
      { type: "tool-input-start", id: "partial", toolName: "bash" } as LanguageModelV3StreamPart,
      nativeEnd,
    ],
  ]) {
    const result = await read(parts)
    expect(result.filter((p) => p.type === "tool-call")).toHaveLength(0)
    expect(result.some((p) => p.type === "error")).toBe(true)
  }
})
test("suspicion emits an immediate notice once and terminal audit once despite callbacks throwing", async () => {
  let notices = 0
  const audits: DSMLRecoveryAuditInput[] = []
  const result = await read(nativeParts(malformedNativeText + call, 1), {
    onSuspect: () => {
      notices++
      throw new Error("synthetic notice failure")
    },
    audit: (input) => {
      audits.push(input)
      throw new Error("synthetic audit failure")
    },
  })
  expect(notices).toBe(1)
  expect(audits).toHaveLength(1)
  expect(audits[0]).toMatchObject({ reason: "native_preserved", recoveredCount: 0 })
  expect(result.filter((p) => p.type === "tool-call")).toEqual([genuineNative])
  expect(result.some((p) => p.type === "error")).toBe(false)
})
test("suspect progress notice precedes finish and cancellation releases its slot", async () => {
  let notice = 0,
    cancelled = false
  const abort = new AbortController()
  let sawNotice!: () => void
  const noticed = new Promise<void>((resolve) => {
    sawNotice = resolve
  })
  const upstream = new ReadableStream<LanguageModelV3StreamPart>({
    start(c) {
      c.enqueue({ type: "text-delta", id: "text", delta: call })
    },
    cancel() {
      cancelled = true
    },
  })
  const reader = recoverDSMLStream(upstream, {
    ...options,
    abort: abort.signal,
    onSuspect: () => {
      notice++
      sawNotice()
    },
  }).getReader()
  const waiting = reader.read()
  await noticed
  expect(notice).toBe(1)
  abort.abort(new Error("synthetic cancellation"))
  await expect(waiting).rejects.toThrow("synthetic cancellation")
  expect(cancelled).toBe(true)
  expect((await read(nativeParts(call, 1))).filter((part) => part.type === "tool-call")).toHaveLength(1)
})
test("valid native input events, metadata and finish survive unchanged", async () => {
  const native = { ...genuineNative, providerMetadata: { fixture: { marker: "synthetic" } } }
  const events: LanguageModelV3StreamPart[] = [
    { type: "tool-input-start", id: native.toolCallId, toolName: "bash" },
    { type: "tool-input-delta", id: native.toolCallId, delta: native.input },
    { type: "tool-input-end", id: native.toolCallId },
    native,
  ]
  const result = await read([...deltas(malformedNativeText).slice(0, -1), ...events, nativeEnd])
  expect(result.filter((part) => part.type.startsWith("tool-"))).toEqual(events)
  expect(result.at(-1)).toEqual(nativeEnd)
})
test("response cap drops a genuinely held native call and releases capacity", async () => {
  const records: DSMLRecoveryAuditInput[] = []
  const parts: LanguageModelV3StreamPart[] = [
    ...nativeParts(malformedNativeText, 7).slice(0, -1),
    { type: "text-delta", id: "text", delta: "x".repeat(2 * 1024 * 1024) },
    nativeEnd,
  ]
  const result = await read(parts, { audit: (record) => records.push(record) })
  expect(result.filter((part) => part.type === "tool-call")).toHaveLength(0)
  expect(records).toMatchObject([{ reason: "response_limit", nativeCount: 1, recoveredCount: 0 }])
  expect((await read(nativeParts(malformedNativeText, 7))).filter((part) => part.type === "tool-call")).toHaveLength(1)
})
test("removed candidate limit does not reject native calls with bounded large malformed prose", async () => {
  const text = '<｜DSML｜invoke name="bash">' + "x".repeat(300 * 1024)
  const result = await read(nativeParts(text, text.length))
  expect(result.filter((p) => p.type === "tool-call")).toEqual([genuineNative])
  expect(result.filter((p) => p.type === "error")).toHaveLength(0)
})
