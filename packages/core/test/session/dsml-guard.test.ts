import { describe, expect, test } from "bun:test"
import type { LanguageModelV3StreamPart } from "@ai-sdk/provider"
import { DateTime } from "effect"
import { toLLMMessages } from "../../src/session/runner/to-llm-message.js"
import { SessionMessage } from "../../src/session/message.js"
import { Model } from "@opencode/schema/model"
import { Provider } from "@opencode/schema/provider"
import { guardDSMLStream } from "../../src/session/llm/dsml-recovery.js"
import {
  EMPTY_VETTING_LOOP_MESSAGE,
  emptyVettingLoopDetector,
  DSML_GUARD_MESSAGE,
  attemptedDSMLInvocation,
  withoutAttemptedDSMLInvocation,
} from "../../src/session/llm/dsml.js"

const orphan =
  '<｜DSML｜parameter name="note">advisory</｜DSML｜parameter>\n\n<｜DSML｜parameter name="command" string="true">synthetic</｜DSML｜parameter>\n</｜DSML｜invoke>\n</｜DSML｜tool_calls>'
const full =
  '<｜DSML｜tool_calls>\n<｜DSML｜invoke name="bash">\n<｜DSML｜parameter name="command">synthetic</｜DSML｜parameter>\n</｜DSML｜invoke>\n</｜DSML｜tool_calls>'

const model = Model.Ref.make({ providerID: Provider.ID.make("llmgw"), id: Model.ID.make("dsv4") })

function assistant(content: SessionMessage.AssistantContent[], error?: SessionMessage.Assistant["error"]) {
  return SessionMessage.Assistant.make({
    id: SessionMessage.ID.make("msg_synthetic"),
    type: "assistant",
    agent: "synthetic" as never,
    model: Model.Ref.make({ providerID: Provider.ID.make("llmgw"), id: Model.ID.make("dsv4") }),
    content,
    error,
    time: { created: DateTime.makeUnsafe(0) },
  })
}

function text(value: string): SessionMessage.AssistantText {
  return SessionMessage.AssistantText.make({ type: "text", text: value })
}

function completedTool(id: string, output: string): SessionMessage.AssistantTool {
  return SessionMessage.AssistantTool.make({
    type: "tool",
    id,
    name: "synthetic",
    state: SessionMessage.ToolStateCompleted.make({
      status: "completed",
      input: {},
      content: [{ type: "text", text: output }],
    }),
    time: { created: DateTime.makeUnsafe(0), completed: DateTime.makeUnsafe(1) },
  })
}

function pendingTool(id: string): SessionMessage.AssistantTool {
  return SessionMessage.AssistantTool.make({
    type: "tool",
    id,
    name: "synthetic",
    state: SessionMessage.ToolStateRunning.make({ status: "running", input: {}, metadata: {} }),
    time: { created: DateTime.makeUnsafe(0) },
  })
}

function failedTool(id: string): SessionMessage.AssistantTool {
  return SessionMessage.AssistantTool.make({
    type: "tool",
    id,
    name: "synthetic",
    state: SessionMessage.ToolStateError.make({
      status: "error",
      input: {},
      error: { type: "tool", message: "synthetic failure" },
    }),
    time: { created: DateTime.makeUnsafe(0), completed: DateTime.makeUnsafe(1) },
  })
}

function reasoning(value: string): SessionMessage.AssistantReasoning {
  return SessionMessage.AssistantReasoning.make({
    type: "reasoning",
    text: value,
    time: { created: DateTime.makeUnsafe(0) },
  })
}

function source(parts: LanguageModelV3StreamPart[]) {
  return new ReadableStream<LanguageModelV3StreamPart>({
    start(controller) {
      for (const part of parts) controller.enqueue(part)
      controller.close()
    },
  })
}

async function read(parts: LanguageModelV3StreamPart[]) {
  const reader = guardDSMLStream(source(parts)).getReader()
  const result: LanguageModelV3StreamPart[] = []
  while (true) {
    const next = await reader.read()
    if (next.done) return result
    result.push(next.value)
  }
}

function deltas(value: string, size = value.length): LanguageModelV3StreamPart[] {
  const out: LanguageModelV3StreamPart[] = [{ type: "text-start", id: "text" }]
  for (let at = 0; at < value.length; at += size)
    out.push({ type: "text-delta", id: "text", delta: value.slice(at, at + size) })
  return [...out, { type: "text-end", id: "text" }, { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } } }]
}

describe("DSML protocol examples and attempts", () => {
  for (const [name, value] of [
    ["orphan command", orphan],
    ["full invocation", full],
    ["unterminated invocation", '<｜DSML｜invoke name="bash">\nsynthetic'],
    ["unterminated command", '<｜DSML｜parameter name="command">synthetic'],
  ])
    test(`detects ${name}`, () => expect(attemptedDSMLInvocation(value)).toBe(true))
  for (const [name, value] of [
    ["ordinary prose", "The parser uses DSML."],
    ["backtick fence", `Example:\n\`\`\`xml\n${full}\n\`\`\``],
    ["tilde fence", `Example:\n~~~xml\n${orphan}\n~~~`],
    ["unterminated fence", `Example:\n\`\`\`xml\n${full}`],
    [
      "blockquote",
      full
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n"),
    ],
    [
      "indented code",
      orphan
        .split("\n")
        .map((line) => `    ${line}`)
        .join("\n"),
    ],
    ["inline code", `Example: \`${full.replaceAll("\n", " ")}\``],
    ["quoted inline example", `The example is "${full.replaceAll("\n", " ")}".`],
  ])
    test(`preserves ${name}`, () => {
      expect(attemptedDSMLInvocation(value)).toBe(false)
      expect(withoutAttemptedDSMLInvocation(value)).toBe(value)
    })
  test("strips only the attempted suffix, preserving preceding quoted example and prose", () => {
    const prefix = `Example:\n\`\`\`xml\n${full}\n\`\`\`\nChecking status.`
    expect(withoutAttemptedDSMLInvocation(`${prefix}\n${orphan}`)).toBe(prefix)
  })
})

test("sanitizes standalone malformed notes without classifying them as executable invocations", () => {
  const note = '<｜DSML｜parameter name="note">advisory</｜DSML｜parameter>'
  expect(attemptedDSMLInvocation(note)).toBe(false)
  expect(withoutAttemptedDSMLInvocation(note)).toBe("")
  expect(withoutAttemptedDSMLInvocation(`Before.\n${note}\nAfter.\n${note}\nDone.`)).toBe("Before.\n\nAfter.\n\nDone.")
  expect(withoutAttemptedDSMLInvocation(`<parameter name="note">ordinary XML</parameter>`)).toBe(
    '<parameter name="note">ordinary XML</parameter>',
  )
  expect(withoutAttemptedDSMLInvocation('<｜DSML｜parameter name="note">missing closer')).toBe(
    '<｜DSML｜parameter name="note">missing closer',
  )
  const incomplete = '<｜DSML｜parameter name="note">missing closer\nMeaningful prose.'
  expect(withoutAttemptedDSMLInvocation(`${incomplete}\n${note}\nAfter.`)).toBe(`${incomplete}\n\nAfter.`)
  expect(
    withoutAttemptedDSMLInvocation(`Before.\n<｜DSML｜parameter name='note'>\nmultiline\n</｜DSML｜parameter>\nAfter.`),
  ).toBe("Before.\n\nAfter.")
})

test("preserves quoted and fenced note-only protocol examples", () => {
  const note = '<｜DSML｜parameter name="note">advisory</｜DSML｜parameter>'
  for (const value of [
    `Example:\n\`\`\`xml\n${note}\n\`\`\``,
    `Example:\n~~~xml\n${note}\n~~~`,
    `> ${note}`,
    `    ${note}`,
    `Example: \`${note}\``,
    `The example is "${note}".`,
  ])
    expect(withoutAttemptedDSMLInvocation(value)).toBe(value)
})

test("merges note cleanup with overlapping closing-only invocation ranges", () => {
  const text = '<｜DSML｜parameter name="note">advisory\n</｜DSML｜invoke>\n</｜DSML｜parameter>\nAfter.'
  expect(withoutAttemptedDSMLInvocation(text)).toBe("\nAfter.")
})

test("does not complete an unclosed note across a fenced protocol example", () => {
  const text =
    '<｜DSML｜parameter name="note">unclosed\nMeaningful prose.\n```xml\n<｜DSML｜parameter name="note">example</｜DSML｜parameter>\n```\n</｜DSML｜parameter>\nAfter.'
  expect(withoutAttemptedDSMLInvocation(text)).toBe(text)
})

test("outgoing history excludes malformed attempt without mutating durable text", () => {
  const original = `Checking status.\n${orphan}`
  const message = assistant([text(original)])
  const before = JSON.stringify(message)
  expect(toLLMMessages([message], model)).toMatchObject([
    { role: "assistant", content: [{ type: "text", text: "Checking status." }] },
  ])
  expect(JSON.stringify(message)).toBe(before)
  for (const other of [
    { providerID: "llmgw", id: "dsv4c" },
    { providerID: "other", id: "dsv4" },
  ])
    expect(toLLMMessages([message], other as never)).toMatchObject([
      { role: "assistant", content: [{ type: "text", text: original }] },
    ])
})

test("outgoing empty-vetting cleanup is destination scoped and leaves durable text unchanged", () => {
  const value = 'before <vetting></vetting> after\n"<vetting></vetting>"'
  const message = assistant([text(value)])
  const before = JSON.stringify(message)
  expect(toLLMMessages([message], model)).toMatchObject([
    { role: "assistant", content: [{ type: "text", text: 'before  after\n"<vetting></vetting>"' }] },
  ])
  for (const other of [
    { providerID: "llmgw", id: "dsv4c" },
    { providerID: "other", id: "dsv4" },
  ])
    expect(toLLMMessages([message], other as never)).toMatchObject([
      { role: "assistant", content: [{ type: "text", text: value }] },
    ])
  expect(JSON.stringify(message)).toBe(before)
})

test("protocol-error history retains completed genuine tools and excludes placeholders", () => {
  for (const failure of [DSML_GUARD_MESSAGE, EMPTY_VETTING_LOOP_MESSAGE]) {
    const message = assistant(
      [text(full), completedTool("executed_once", "recorded completed result"), pendingTool("not_dispatched"), failedTool("failed_placeholder"), reasoning("hidden malformed reasoning")],
      { type: "unknown", message: failure },
    )
    const before = JSON.stringify(message)
    const result = toLLMMessages([message], model)
    const serialized = JSON.stringify(result)
    expect(serialized).toContain("executed_once")
    expect(serialized).toContain("recorded completed result")
    expect(serialized).not.toContain("not_dispatched")
    expect(serialized).not.toContain("failed_placeholder")
    expect(serialized).not.toContain("hidden malformed reasoning")
    expect(serialized).not.toContain("DSML")
    expect(JSON.stringify(message)).toBe(before)
    expect(result.map((entry) => entry.role)).toEqual(["assistant", "tool"])
    expect(serialized.match(/executed_once/g)?.length).toBe(2)
    expect(toLLMMessages([message], model)).toEqual(result)
    const generic = assistant([text(full), completedTool("executed_once", "recorded completed result")], {
      type: "unknown",
      message: "ordinary unrelated failure",
    })
    const genericResult = JSON.stringify(toLLMMessages([generic], model))
    expect(genericResult).toContain("recorded completed result")
    expect(genericResult).not.toContain("DSML")
    const noCompletedTools = assistant([text(full), pendingTool("not_dispatched")], {
      type: "unknown",
      message: failure,
    })
    expect(toLLMMessages([noCompletedTools], model)).toEqual([])
  }
})

test("legacy aborted empty loop with unmatched trailing opener is excluded from replay", () => {
  const message = assistant([text("<vetting> \r\n</vetting>\n".repeat(1024) + "<vetting>\n")], {
    type: "aborted",
    message: "synthetic abort",
  })
  const before = JSON.stringify(message)
  expect(toLLMMessages([message], model)).toEqual([])
  expect(JSON.stringify(message)).toBe(before)
})

test("legacy aborted loop preserves only completed real results exactly once", () => {
  const message = assistant(
    [
      text("<vetting></vetting>".repeat(1024) + "<vetting>"),
      reasoning("legacy reasoning sentinel"),
      completedTool("legacy_executed_once", "legacy completed result"),
      pendingTool("legacy_pending"),
      failedTool("legacy_failed"),
    ],
    { type: "aborted", message: "synthetic abort" },
  )
  const before = JSON.stringify(message)
  const result = toLLMMessages([message], model)
  const serialized = JSON.stringify(result)
  expect(result.map((entry) => entry.role)).toEqual(["assistant", "tool"])
  expect(serialized).toContain("legacy completed result")
  expect(serialized.match(/legacy_executed_once/g)?.length).toBe(2)
  for (const excluded of ["vetting", "legacy reasoning sentinel", "legacy_pending", "legacy_failed"])
    expect(serialized).not.toContain(excluded)
  expect(JSON.stringify(message)).toBe(before)
})

test("legacy loop detection shares text state across parts and ignored part types", () => {
  const blocks = "<vetting></vetting>".repeat(16) + "<vetting>"
  for (const texts of [[blocks.slice(0, 8), blocks.slice(8)], [blocks.slice(0, 152), blocks.slice(152)], [...blocks]]) {
    const message = assistant(
      [...texts.map((value) => text(value)), reasoning("interleaved ignored prose"), completedTool("interleaved_result", "interleaved ignored prose")],
      { type: "aborted", message: "synthetic abort" },
    )
    const serialized = JSON.stringify(toLLMMessages([message], model))
    expect(serialized).not.toContain("vetting")
    expect(serialized).toContain("interleaved_result")
  }
})

test("legacy aborted protected examples and ordinary text retain prior replay policy", () => {
  const block = "<vetting></vetting>"
  const examples = [
    "ordinary prose",
    block.repeat(15),
    "<vetting>nonempty</vetting>".repeat(40),
    "<vetting>" + block.repeat(40) + "</vetting>",
    '"' + block.repeat(16) + '"',
    "'" + block.repeat(16) + "'",
    "`" + block.repeat(16) + "`",
    'assignment="' + block.repeat(16) + '"',
    '"escaped \\"' + block.repeat(16) + '"',
    '````xml title="unfinished\n```\n' + block.repeat(16) + "\n````",
    "~~~~xml\n~~~\n" + block.repeat(16) + "\n~~~~",
    "\n    " + block.repeat(16),
    "\n> " + block.repeat(16),
  ]
  for (const value of examples) {
    const message = assistant(
      [text("ordinary sentinel " + value), reasoning("legacy reasoning sentinel"), completedTool("legacy_executed_once", "legacy completed result"), pendingTool("legacy_pending")],
      { type: "aborted", message: "synthetic abort" },
    )
    const before = JSON.stringify(message)
    const result = JSON.stringify(toLLMMessages([message], model))
    expect(result).toContain("legacy completed result")
    expect(result).toContain("legacy_pending")
    expect(JSON.stringify(message)).toBe(before)
  }
})

test("legacy detector ignores markup in reasoning, tool arguments/results and user text", () => {
  const blocks = "<vetting></vetting>".repeat(16) + "<vetting>"
  const message = assistant(
    [text("ordinary sentinel"), reasoning(blocks), completedTool("legacy_executed_once", blocks)],
    { type: "aborted", message: "synthetic abort" },
  )
  const result = JSON.stringify(toLLMMessages([message], model))
  expect(result).toContain("ordinary sentinel")
  expect(result).toContain("vetting")
})

test("legacy loop correction is destination scoped and leaves unrelated error shapes unchanged", () => {
  const blocks = "<vetting></vetting>".repeat(1024) + "<vetting>"
  for (const other of [
    { providerID: "llmgw", id: "other" },
    { providerID: "other", id: "dsv4" },
  ]) {
    const message = assistant(
      [text(blocks), completedTool("legacy_executed_once", "legacy completed result"), pendingTool("legacy_pending")],
      { type: "aborted", message: "synthetic abort" },
    )
    const result = JSON.stringify(toLLMMessages([message], other as never))
    expect(result).toContain("vetting")
    expect(result).toContain("legacy_pending")
    expect(result).toContain("legacy completed result")
  }
  const successful = assistant([text(blocks), completedTool("legacy_executed_once", "legacy completed result")])
  expect(JSON.stringify(toLLMMessages([successful], model))).toContain("vetting")
  const unrelated = assistant([text(blocks), completedTool("legacy_executed_once", "legacy completed result")], {
    type: "unknown",
    message: "ordinary unrelated failure",
  })
  expect(JSON.stringify(toLLMMessages([unrelated], model))).toContain("vetting")
})

test("empty vetting loop threshold is chunk invariant and prose resets", () => {
  const block = "<vetting> \r\n</vetting>\n"
  for (const size of [1, 7, 4096]) {
    for (const [value, hit] of [
      [block.repeat(15), false],
      [block.repeat(16), true],
      [block.repeat(15) + "ordinary prose\n" + block.repeat(15), false],
      ["<vetting>nonempty</vetting>".repeat(30), false],
    ] as const) {
      const scanner = emptyVettingLoopDetector()
      let found = false
      for (let at = 0; at < value.length; at += size) found ||= scanner.feed(value.slice(at, at + size)) !== -1
      expect(found).toBe(hit)
    }
  }
})

test("empty vetting quoted and fenced examples never count, including long fences", () => {
  const blocks = "<vetting></vetting>".repeat(16)
  const examples = [
    "'" + blocks + "'",
    '"' + blocks + '"',
    "`" + blocks + "`",
    "````xml\n```\n" + blocks + "\n````",
    "~~~xml\n" + "x".repeat(9000) + "\n" + blocks + "\n~~~",
    "> " + blocks,
    "    " + blocks,
    "~".repeat(5000) + "\n" + "~".repeat(4096) + "\n" + blocks + "\n" + "~".repeat(5000),
  ]
  for (const value of examples)
    for (const size of [1, 7, value.length]) {
      const scanner = emptyVettingLoopDetector()
      for (let at = 0; at < value.length; at += size) expect(scanner.feed(value.slice(at, at + size))).toBe(-1)
    }
})

test("assignment and attribute quotes protect loops while word apostrophes do not", () => {
  const blocks = "<vetting></vetting>".repeat(16)
  for (const value of [
    'example="' + blocks + '"',
    "example='" + blocks + "'",
    '<sample value="' + blocks + '">',
    'punctuation,"' + blocks + '"',
    "<sample value='" + blocks + "'>",
  ]) {
    for (const size of [1, 7, value.length]) {
      const scanner = emptyVettingLoopDetector()
      for (let at = 0; at < value.length; at += size) expect(scanner.feed(value.slice(at, at + size))).toBe(-1)
    }
  }
  const scanner = emptyVettingLoopDetector()
  expect(scanner.feed("don't mistake prose for a quote. " + blocks)).not.toBe(-1)
})

test("single quoted operator literals are protected while word apostrophes remain prose", () => {
  const blocks = "<vetting></vetting>".repeat(16)
  for (const prefix of ["prefix+", "prefix-", "prefix/", "prefix|", "prefix&", "prefix.", "prefix?"]) {
    const value = prefix + "'" + blocks + "'"
    for (const size of [1, 7, value.length]) {
      const scanner = emptyVettingLoopDetector()
      for (let at = 0; at < value.length; at += size) expect(scanner.feed(value.slice(at, at + size))).toBe(-1)
    }
  }
  for (const value of ["don't", "I'll", "élève's"]) {
    const scanner = emptyVettingLoopDetector()
    expect(scanner.feed(value + " " + blocks)).not.toBe(-1)
  }
})

test("stray inline quotes and backticks reset at newline without disarming loops", () => {
  const blocks = "<vetting> \r\n</vetting>\n".repeat(16)
  for (const preamble of [
    '"',
    "'",
    "the '90s",
    "6'2\" tall.",
    "Use `foo",
    'assignment="unfinished',
    'escaped=\\"unfinished',
    "Use ``foo",
  ]) {
    for (const newline of ["\n", "\r\n"])
      for (const size of [1, 7, 4096]) {
        const scanner = emptyVettingLoopDetector()
        const value = preamble + newline + blocks
        let detected = false
        for (let at = 0; at < value.length; at += size) {
          if (scanner.feed(value.slice(at, at + size)) !== -1) {
            detected = true
            break
          }
        }
        expect(detected).toBe(true)
      }
  }
})

test("quoted fence info and shorter internal delimiters preserve multiline protection", () => {
  const blocks = "<vetting></vetting>".repeat(16)
  for (const opener of ['````xml title="unfinished', "~~~~xml title='unfinished"]) {
    const delimiter = opener[0].repeat(4)
    const value = opener + '\nstray " and `\n' + opener[0].repeat(3) + "\n" + blocks + "\n" + delimiter + "\n"
    for (const size of [1, 7, 4096]) {
      const scanner = emptyVettingLoopDetector()
      for (let at = 0; at < value.length; at += size) expect(scanner.feed(value.slice(at, at + size))).toBe(-1)
      expect(scanner.feed(blocks)).not.toBe(-1)
    }
  }
})

test("empty vetting cleanup removes only complete unprotected unnested empty blocks", () => {
  const block = "<vetting></vetting>"
  for (const value of [block, "<vetting> \t\r\n </vetting>", block.repeat(5)]) {
    expect(withoutAttemptedDSMLInvocation(value)).toBe("")
    expect(withoutAttemptedDSMLInvocation("before " + value + " after")).toBe("before  after")
    expect(attemptedDSMLInvocation(value)).toBe(false)
  }
  for (const value of [
    '"' + block + '"',
    "'" + block + "'",
    "`" + block + "`",
    "``" + block + "``",
    'assignment="' + block + '"',
    '"escaped \\"' + block + '"',
    '"unfinished ' + block,
    "'unfinished " + block,
    "`unfinished " + block,
    "```xml\n" + block + "\n```",
    '~~~~xml title="unfinished\n' + block + "\n~~~~",
    "    " + block,
    "\t" + block,
    "> " + block,
    '<vetting>"quoted nonempty"</vetting>',
    "<vetting>`code`</vetting>",
    "<vetting>nonempty</vetting>",
    "<vetting>",
    "</vetting>",
    "<vetting>" + block + "</vetting>",
    "<vetting>" + block,
    block + "</vetting>",
  ])
    expect(withoutAttemptedDSMLInvocation(value)).toBe(value)
  expect(withoutAttemptedDSMLInvocation('"unfinished\n' + block)).toBe('"unfinished\n')
  expect(withoutAttemptedDSMLInvocation("before\n" + block + "\nafter")).toBe("before\n\nafter")
})

test("nonempty and nested vetting blocks cannot contribute to an empty streak", () => {
  const empty = "<vetting></vetting>"
  for (const value of [
    "<vetting>nonempty</vetting>".repeat(40),
    "<vetting>" + empty.repeat(40) + "</vetting>",
    empty.repeat(15) + "<vetting>nonempty</vetting>" + empty.repeat(15),
  ])
    for (const size of [1, 7, 4096]) {
      const scanner = emptyVettingLoopDetector()
      for (let at = 0; at < value.length; at += size) expect(scanner.feed(value.slice(at, at + size))).toBe(-1)
    }
})

test("empty vetting cleanup preserves surrounding whitespace byte for byte", () => {
  const block = "<vetting></vetting>"
  for (const suffix of ["  \n", "\t\r\n", " ", "\n\n"]) {
    expect(withoutAttemptedDSMLInvocation("before" + block + suffix)).toBe("before" + suffix)
    expect(withoutAttemptedDSMLInvocation("  \n" + block + suffix)).toBe("  \n" + suffix)
    expect(withoutAttemptedDSMLInvocation("before" + block + block + suffix)).toBe("before" + suffix)
  }
})

test("DSML-only guard rejects an orphan invocation instead of silently accepting stop", async () => {
  const result = await read(deltas(`Checking status.\n${orphan}`))
  expect(result.filter((part) => part.type === "error")).toHaveLength(1)
})

test("DSML-only guard rejects an invocation split across streamed deltas", async () => {
  const result = await read(deltas(full, 1))
  expect(result.filter((part) => part.type === "error")).toHaveLength(1)
})

test("DSML-only guard triggers even in quoted prose or with a companion tool", async () => {
  for (const value of ["Example: `" + full + "`", "```xml\n" + full + "\n```", "> " + full]) {
    const result = await read(deltas(value, 1))
    expect(result.some((part) => part.type === "error")).toBe(true)
  }
})

test("DSML-only guard leaves plain XML and reasoning text alone", async () => {
  const result = await read([
    { type: "text-start", id: "text" },
    { type: "text-delta", id: "text", delta: '<parameter name="host">synthetic</parameter>' },
    { type: "reasoning-start", id: "reasoning" },
    { type: "reasoning-delta", id: "reasoning", delta: "</｜DSML｜parameter>" },
    { type: "reasoning-end", id: "reasoning" },
    { type: "text-end", id: "text" },
    { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } } },
  ])
  expect(result.some((part) => part.type === "error")).toBe(false)
})

test("DSML-only guard resets at each stream start", async () => {
  const result = await read([
    { type: "stream-start", warnings: [] },
    ...deltas(orphan),
    { type: "stream-start", warnings: [] },
    ...deltas("Finished checking."),
  ])
  expect(result.filter((part) => part.type === "error")).toHaveLength(1)
})
