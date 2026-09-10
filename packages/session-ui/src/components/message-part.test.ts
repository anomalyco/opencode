import { describe, expect, test } from "bun:test"
import { readPartText } from "./message-part-text"
import { formatTaskSubtitle } from "./message-part-task"
import type { Message, Part, UserMessage } from "@opencode-ai/sdk/v2"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { closureEvidencePart, isHumanUserMessage, partitionUserTranscript } from "./closure-record"
import { CLOSURE_RECORD_METADATA_KEY } from "@opencode-ai/core/session/closure-record"

function closureRows(): { info: UserMessage; parts: Part[] }[] {
  const sessionID = "ses_closure_shared"
  const message = (id: string) =>
    ({
      id,
      sessionID,
      role: "user",
      agent: "build",
      model: { providerID: "provider", modelID: "model" },
      time: { created: 1 },
    }) as UserMessage
  const text = (messageID: string, value: string, synthetic = false, metadata?: Record<string, unknown>): Part => ({
    id: `part_${messageID}`,
    sessionID,
    messageID,
    type: "text",
    text: value,
    ...(synthetic ? { synthetic: true } : {}),
    ...(metadata ? { metadata } : {}),
  })
  const closure = message("msg_1_closure")
  const sentence = "[Branch closure] This Session's prior Task execution: Cancellation won physical closure."
  const payload = {
    version: 1,
    freeze_owner_operation_id: "op_shared",
    generation: 1,
    fact_key: "self:ses_closure_shared",
    identity_source: "session_identity",
    record_kind: "self",
    subject_session_id: sessionID,
    terminal_outcome: "cancelled",
  }
  const human = message("msg_2_human")
  const synthetic = message("msg_3_synthetic")
  const malformed = message("msg_4_malformed")
  const partial = message("msg_5_partial")
  return [
    { info: closure, parts: [text(closure.id, sentence, true, { [CLOSURE_RECORD_METADATA_KEY]: payload })] },
    { info: human, parts: [text(human.id, "ordinary human row")] },
    { info: synthetic, parts: [text(synthetic.id, "ordinary synthetic row", true)] },
    {
      info: malformed,
      parts: [
        text(malformed.id, "malformed lookalike has distinct text", true, {
          [CLOSURE_RECORD_METADATA_KEY]: payload,
        }),
      ],
    },
    {
      info: partial,
      parts: [
        text(partial.id, "multipart lookalike first distinct text", true, {
          [CLOSURE_RECORD_METADATA_KEY]: payload,
        }),
        { ...text(partial.id, "multipart lookalike second distinct text", true), id: "part_partial_second" },
      ],
    },
  ]
}

function region(source: string, start: string, end: string) {
  const from = source.indexOf(start)
  expect(from).toBeGreaterThan(-1)
  const to = source.indexOf(end, from + start.length)
  expect(to).toBeGreaterThan(from)
  return source.slice(from, to)
}

describe("readPartText", () => {
  test("returns empty string when accum is undefined and part text is undefined", () => {
    expect(readPartText(undefined, { id: "part_1" })).toBe("")
  })

  test("returns trimmed part text when accum is undefined", () => {
    expect(readPartText(undefined, { id: "part_1", text: "  hello  " })).toBe("hello")
  })

  test("prefers accum value over part text when accum has a hit", () => {
    expect(readPartText({ part_1: "  from accum  " }, { id: "part_1", text: "from part" })).toBe("from accum")
  })

  test("falls back to part text when accum misses", () => {
    expect(readPartText({ other_part: "ignored" }, { id: "part_1", text: "  from part  " })).toBe("from part")
  })

  test("returns empty string for whitespace-only text", () => {
    expect(readPartText(undefined, { id: "part_1", text: "   \n\t  " })).toBe("")
  })

  test("trims leading and trailing whitespace", () => {
    expect(readPartText(undefined, { id: "part_1", text: "\n  body  \n" })).toBe("body")
  })
})

describe("formatTaskSubtitle", () => {
  test("renders async vocabulary from retained background metadata", () => {
    expect(formatTaskSubtitle("Inspect renderer", true)).toBe("Inspect renderer (async)")
  })

  test("leaves synchronous and absent subtitles unchanged", () => {
    expect(formatTaskSubtitle("Inspect renderer", false)).toBe("Inspect renderer")
    expect(formatTaskSubtitle(undefined, true)).toBeUndefined()
    expect(formatTaskSubtitle("", true)).toBe("")
  })
})

describe("shared closure evidence selectors", () => {
  test("the shared classifier partitions genuine evidence from four discriminating non-record rows", () => {
    const rows = closureRows()
    const messages = rows.map((row) => row.info) as Message[]
    const parts = new Map(rows.map((row) => [row.info.id, row.parts]))

    expect(rows.map((row) => closureEvidencePart(row.info, row.parts)?.text ?? null)).toEqual([
      "[Branch closure] This Session's prior Task execution: Cancellation won physical closure.",
      null,
      null,
      null,
      null,
    ])
    expect(rows.map((row) => isHumanUserMessage(row.info, row.parts))).toEqual([false, true, true, true, true])

    const partition = partitionUserTranscript(messages, (messageID) => parts.get(messageID) ?? [])
    expect(partition.human.map((message) => message.id)).toEqual([
      "msg_2_human",
      "msg_3_synthetic",
      "msg_4_malformed",
      "msg_5_partial",
    ])
    expect(partition.evidence.map((message) => message.id)).toEqual(["msg_1_closure"])
    expect(partition.visible.map((message) => message.id)).toEqual(rows.map((row) => row.info.id))
  })

  test("the shared Message branch precedes User actions and SessionTurn refuses evidence as a human turn", () => {
    const messagePart = readFileSync(fileURLToPath(new URL("./message-part.tsx", import.meta.url)), "utf8")
    const dispatch = region(messagePart, "export function Message(props", "export function AssistantMessageDisplay")
    const closure = region(dispatch, "<Match when={closure()}", '<Match when={props.message.role === "user"')
    expect(closure).toContain("<BranchClosureDisplay")
    expect(closure).not.toContain("actions=")
    expect(dispatch).toContain("actions={props.actions}")
    expect(messagePart).toContain('data-component="branch-closure" role="note"')
    expect(messagePart).toContain('p.type === "text" && !(p as TextPart).synthetic')
    const styles = readFileSync(fileURLToPath(new URL("./message-part.css", import.meta.url)), "utf8")
    expect(styles).toContain('[data-component="branch-closure"]')
    expect(region(styles, '[data-component="branch-closure"]', '[data-component="user-message"]')).toContain(
      "var(--v2-text-text-muted)",
    )

    const turn = readFileSync(fileURLToPath(new URL("./session-turn.tsx", import.meta.url)), "utf8")
    const selection = region(turn, "const messageIndex = createMemo", "const pending = createMemo")
    expect(selection).toContain("isHumanUserMessage(msg")
    expect(selection).toContain("data.store.part?.[msg.id]")
    expect(turn).toContain("<Message message={message()!} parts={parts()} actions={props.actions} />")
  })

  test("the Web classifier stays textually identical to core modulo its declared browser-local header", () => {
    const core = readFileSync(
      fileURLToPath(new URL("../../../core/src/session/closure-record.ts", import.meta.url)),
      "utf8",
    ).replaceAll("\r\n", "\n")
    const web = readFileSync(
      fileURLToPath(new URL("../../../web/src/components/share/closure-record.ts", import.meta.url)),
      "utf8",
    ).replaceAll("\r\n", "\n")
    const header =
      "// Browser-local parity copy: packages/web deliberately has no runtime dependency on @opencode-ai/core.\n"
    expect(web.startsWith(header)).toBe(true)
    expect(web.slice(header.length)).toBe(core)
  })

  test("Enterprise partitions selectors from chronological evidence and guards evidence-only shares", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../../../enterprise/src/routes/share/[shareID].tsx", import.meta.url)),
      "utf8",
    )
    const selector = region(source, "const transcript = createMemo", "const provider = createMemo")
    expect(selector).toContain("partitionUserTranscript(")
    expect(selector).toContain("const messages = createMemo(() => transcript().human)")
    expect(selector).toContain("const transcriptMessages = createMemo(() => transcript().visible)")
    expect(selector).not.toContain('.filter((m) => m.role === "user")')
    expect(selector).not.toContain("firstUserMessage()!")

    const turns = region(source, "const turns = () =>", "const wide = createMemo")
    expect(turns).toContain("<For each={transcriptMessages()}>")
    expect(turns).toContain("closureEvidencePart(message")
    expect(turns).toContain("<MessageDisplay message={message}")
    expect(turns).not.toContain("actions=")
    expect(source).toContain("<For each={activeTranscript()}>")
    expect(source).not.toContain("firstUserMessage()!.id")

    expect(source.replace(selector, "")).toContain('msg.role === "assistant"')
  })
})
