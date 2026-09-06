import { describe, expect, test } from "bun:test"
import { formatAssistantHeader, formatMessage, formatPart, formatTranscript } from "../../src/util/transcript"
import type { AssistantMessage, Part, Provider, UserMessage } from "@opencode-ai/sdk/v2"
import { CLOSURE_RECORD_METADATA_KEY } from "@opencode-ai/core/session/closure-record"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import {
  closureEvidencePart,
  isHumanUserMessage,
  isMessageNavigationStop,
  taskSpinnerRunning,
  transcriptStatus,
} from "../../src/util/closure-record"

const providers: Provider[] = [
  {
    id: "anthropic",
    name: "Anthropic",
    source: "api",
    env: [],
    options: {},
    models: {
      "claude-sonnet-4-20250514": {
        id: "claude-sonnet-4-20250514",
        providerID: "anthropic",
        api: {
          id: "claude-sonnet-4-20250514",
          url: "https://example.com/claude-sonnet-4-20250514",
          npm: "@ai-sdk/anthropic",
        },
        name: "Claude Sonnet 4",
        capabilities: {
          temperature: true,
          reasoning: true,
          attachment: true,
          toolcall: true,
          input: {
            text: true,
            audio: false,
            image: true,
            video: false,
            pdf: true,
          },
          output: {
            text: true,
            audio: false,
            image: false,
            video: false,
            pdf: false,
          },
          interleaved: false,
        },
        cost: {
          input: 0,
          output: 0,
          cache: {
            read: 0,
            write: 0,
          },
        },
        limit: {
          context: 200_000,
          output: 8_192,
        },
        status: "active",
        options: {},
        headers: {},
        release_date: "2025-05-14",
      },
    },
  },
]

function closureRows(): { info: UserMessage; parts: Part[] }[] {
  const sessionID = "ses_closure_tui"
  const message = (id: string) =>
    ({
      id,
      sessionID,
      role: "user",
      agent: "build",
      model: { providerID: "anthropic", modelID: "claude-sonnet-4-20250514" },
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
    freeze_owner_operation_id: "op_tui",
    generation: 1,
    fact_key: "self:ses_closure_tui",
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
    {
      info: closure,
      parts: [text(closure.id, sentence, true, { [CLOSURE_RECORD_METADATA_KEY]: payload })],
    },
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

describe("transcript", () => {
  describe("formatAssistantHeader", () => {
    const baseMsg: AssistantMessage = {
      id: "msg_123",
      sessionID: "ses_123",
      role: "assistant",
      agent: "build",
      modelID: "claude-sonnet-4-20250514",
      providerID: "anthropic",
      mode: "",
      parentID: "msg_parent",
      path: { cwd: "/test", root: "/test" },
      cost: 0.001,
      tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: 1000000, completed: 1005400 },
    }

    test("includes metadata when enabled", () => {
      const result = formatAssistantHeader(baseMsg, true)
      expect(result).toBe("## Assistant (Build · claude-sonnet-4-20250514 · 5.4s)\n\n")
    })

    test("uses model display name when available", () => {
      const result = formatAssistantHeader(baseMsg, true, providers)
      expect(result).toBe("## Assistant (Build · Claude Sonnet 4 · 5.4s)\n\n")
    })

    test("excludes metadata when disabled", () => {
      const result = formatAssistantHeader(baseMsg, false)
      expect(result).toBe("## Assistant\n\n")
    })

    test("handles missing completed time", () => {
      const msg = { ...baseMsg, time: { created: 1000000 } }
      const result = formatAssistantHeader(msg as AssistantMessage, true)
      expect(result).toBe("## Assistant (Build · claude-sonnet-4-20250514)\n\n")
    })

    test("titlecases agent name", () => {
      const msg = { ...baseMsg, agent: "plan" }
      const result = formatAssistantHeader(msg, true)
      expect(result).toContain("Plan")
    })
  })

  describe("formatPart", () => {
    const options = { thinking: true, toolDetails: true, assistantMetadata: true }

    test("formats text part", () => {
      const part: Part = {
        id: "part_1",
        sessionID: "ses_123",
        messageID: "msg_123",
        type: "text",
        text: "Hello world",
      }
      const result = formatPart(part, options)
      expect(result).toBe("Hello world\n\n")
    })

    test("skips synthetic text parts", () => {
      const part: Part = {
        id: "part_1",
        sessionID: "ses_123",
        messageID: "msg_123",
        type: "text",
        text: "Synthetic content",
        synthetic: true,
      }
      const result = formatPart(part, options)
      expect(result).toBe("")
    })

    test("formats reasoning when thinking enabled", () => {
      const part: Part = {
        id: "part_1",
        sessionID: "ses_123",
        messageID: "msg_123",
        type: "reasoning",
        text: "Let me think...",
        time: { start: 1000 },
      }
      const result = formatPart(part, options)
      expect(result).toBe("_Thinking:_\n\nLet me think...\n\n")
    })

    test("skips reasoning when thinking disabled", () => {
      const part: Part = {
        id: "part_1",
        sessionID: "ses_123",
        messageID: "msg_123",
        type: "reasoning",
        text: "Let me think...",
        time: { start: 1000 },
      }
      const result = formatPart(part, { ...options, thinking: false })
      expect(result).toBe("")
    })

    test("formats tool part with details", () => {
      const part: Part = {
        id: "part_1",
        sessionID: "ses_123",
        messageID: "msg_123",
        type: "tool",
        callID: "call_1",
        tool: "bash",
        state: {
          status: "completed",
          input: { command: "ls" },
          output: "file1.txt\nfile2.txt",
          title: "List files",
          metadata: {},
          time: { start: 1000, end: 1100 },
        },
      }
      const result = formatPart(part, options)
      expect(result).toContain("**Tool: bash**")
      expect(result).toContain("**Input:**")
      expect(result).toContain('"command": "ls"')
      expect(result).toContain("**Output:**")
      expect(result).toContain("file1.txt")
    })

    test("formats tool output containing triple backticks without breaking markdown", () => {
      const part: Part = {
        id: "part_1",
        sessionID: "ses_123",
        messageID: "msg_123",
        type: "tool",
        callID: "call_1",
        tool: "bash",
        state: {
          status: "completed",
          input: { command: "echo '```hello```'" },
          output: "```hello```",
          title: "Echo backticks",
          metadata: {},
          time: { start: 1000, end: 1100 },
        },
      }
      const result = formatPart(part, options)
      // The tool header should not be inside a code block
      expect(result).toStartWith("**Tool: bash**\n")
      // Input and output should each be in their own code blocks
      expect(result).toContain("**Input:**\n```json")
      expect(result).toContain("**Output:**\n```\n```hello```\n```")
    })

    test("formats tool part without details when disabled", () => {
      const part: Part = {
        id: "part_1",
        sessionID: "ses_123",
        messageID: "msg_123",
        type: "tool",
        callID: "call_1",
        tool: "bash",
        state: {
          status: "completed",
          input: { command: "ls" },
          output: "file1.txt",
          title: "List files",
          metadata: {},
          time: { start: 1000, end: 1100 },
        },
      }
      const result = formatPart(part, { ...options, toolDetails: false })
      expect(result).toContain("**Tool: bash**")
      expect(result).not.toContain("**Input:**")
      expect(result).not.toContain("**Output:**")
    })

    test("formats tool error", () => {
      const part: Part = {
        id: "part_1",
        sessionID: "ses_123",
        messageID: "msg_123",
        type: "tool",
        callID: "call_1",
        tool: "bash",
        state: {
          status: "error",
          input: { command: "invalid" },
          error: "Command failed",
          time: { start: 1000, end: 1100 },
        },
      }
      const result = formatPart(part, options)
      expect(result).toContain("**Error:**")
      expect(result).toContain("Command failed")
    })
  })

  describe("formatMessage", () => {
    const options = { thinking: true, toolDetails: true, assistantMetadata: true, providers }

    test("formats user message", () => {
      const msg: UserMessage = {
        id: "msg_123",
        sessionID: "ses_123",
        role: "user",
        agent: "build",
        model: { providerID: "anthropic", modelID: "claude-sonnet-4-20250514" },
        time: { created: 1000000 },
      }
      const parts: Part[] = [{ id: "p1", sessionID: "ses_123", messageID: "msg_123", type: "text", text: "Hello" }]
      const result = formatMessage(msg, parts, options)
      expect(result).toContain("## User")
      expect(result).toContain("Hello")
    })

    test("formats assistant message with metadata", () => {
      const msg: AssistantMessage = {
        id: "msg_123",
        sessionID: "ses_123",
        role: "assistant",
        agent: "build",
        modelID: "claude-sonnet-4-20250514",
        providerID: "anthropic",
        mode: "",
        parentID: "msg_parent",
        path: { cwd: "/test", root: "/test" },
        cost: 0.001,
        tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: 1000000, completed: 1005400 },
      }
      const parts: Part[] = [{ id: "p1", sessionID: "ses_123", messageID: "msg_123", type: "text", text: "Hi there" }]
      const result = formatMessage(msg, parts, options)
      expect(result).toContain("## Assistant (Build · Claude Sonnet 4 · 5.4s)")
      expect(result).toContain("Hi there")
    })
  })

  describe("formatTranscript", () => {
    test("renders only a complete closure pair as Branch closure and omits empty synthetic User turns", () => {
      const rows = closureRows()
      expect(rows.map((row) => !!closureEvidencePart(row.info, row.parts))).toEqual([true, false, false, false, false])

      const result = formatTranscript(
        { id: "ses_closure_tui", title: "Closure transcript", time: { created: 1, updated: 2 } },
        rows,
        { thinking: false, toolDetails: false, assistantMetadata: false },
      )

      expect(result).toContain(
        "## Branch closure\n\n[Branch closure] This Session's prior Task execution: Cancellation won physical closure.\n\n",
      )
      expect(result.match(/## User/g)).toHaveLength(1)
      expect(result).toContain("## User\n\nordinary human row\n\n")
      expect(result).not.toContain("ordinary synthetic row")
      expect(result).not.toContain("malformed lookalike has distinct text")
      expect(result).not.toContain("multipart lookalike")
      expect(result.match(/---/g)).toHaveLength(3)
    })

    test("formats complete transcript", () => {
      const session = {
        id: "ses_abc123",
        title: "Test Session",
        time: { created: 1000000000000, updated: 1000000001000 },
      }
      const messages = [
        {
          info: {
            id: "msg_1",
            sessionID: "ses_abc123",
            role: "user" as const,
            agent: "build",
            model: { providerID: "anthropic", modelID: "claude-sonnet-4-20250514" },
            time: { created: 1000000000000 },
          },
          parts: [{ id: "p1", sessionID: "ses_abc123", messageID: "msg_1", type: "text" as const, text: "Hello" }],
        },
        {
          info: {
            id: "msg_2",
            sessionID: "ses_abc123",
            role: "assistant" as const,
            agent: "build",
            modelID: "claude-sonnet-4-20250514",
            providerID: "anthropic",
            mode: "",
            parentID: "msg_1",
            path: { cwd: "/test", root: "/test" },
            cost: 0.001,
            tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
            time: { created: 1000000000100, completed: 1000000000600 },
          },
          parts: [{ id: "p2", sessionID: "ses_abc123", messageID: "msg_2", type: "text" as const, text: "Hi!" }],
        },
      ]
      const options = {
        thinking: false,
        toolDetails: false,
        assistantMetadata: true,
        providers,
      }

      const result = formatTranscript(session, messages, options)

      expect(result).toContain("# Test Session")
      expect(result).toContain("**Session ID:** ses_abc123")
      expect(result).toContain("## User")
      expect(result).toContain("Hello")
      expect(result).toContain("## Assistant (Build · Claude Sonnet 4 · 0.5s)")
      expect(result).toContain("Hi!")
      expect(result).toContain("---")
    })

    test("orders messages by creation time and preserves part order", () => {
      const message = (id: string, created: number, parts: string[]) => ({
        info: {
          id,
          sessionID: "ses_abc123",
          role: "user" as const,
          agent: "build",
          model: { providerID: "anthropic", modelID: "claude" },
          time: { created },
        },
        parts: parts.map((text, index) => ({
          id: `part_${parts.length - index}`,
          sessionID: "ses_abc123",
          messageID: id,
          type: "text" as const,
          text,
        })),
      })
      const result = formatTranscript(
        { id: "ses_abc123", title: "Order", time: { created: 1, updated: 2 } },
        [message("msg_a", 30, ["third"]), message("msg_z", 10, ["first", "second"])],
        { thinking: false, toolDetails: false, assistantMetadata: false },
      )

      expect(result.indexOf("first")).toBeLessThan(result.indexOf("second"))
      expect(result.indexOf("second")).toBeLessThan(result.indexOf("third"))
    })

    test("falls back to raw model id when provider data is missing", () => {
      const session = {
        id: "ses_abc123",
        title: "Test Session",
        time: { created: 1000000000000, updated: 1000000001000 },
      }
      const messages = [
        {
          info: {
            id: "msg_1",
            sessionID: "ses_abc123",
            role: "assistant" as const,
            agent: "build",
            modelID: "claude-sonnet-4-20250514",
            providerID: "anthropic",
            mode: "",
            parentID: "msg_0",
            path: { cwd: "/test", root: "/test" },
            cost: 0.001,
            tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
            time: { created: 1000000000100, completed: 1000000000600 },
          },
          parts: [{ id: "p1", sessionID: "ses_abc123", messageID: "msg_1", type: "text" as const, text: "Response" }],
        },
      ]

      const result = formatTranscript(session, messages, {
        thinking: false,
        toolDetails: false,
        assistantMetadata: true,
      })

      expect(result).toContain("## Assistant (Build · claude-sonnet-4-20250514 · 0.5s)")
    })

    test("formats transcript without assistant metadata", () => {
      const session = {
        id: "ses_abc123",
        title: "Test Session",
        time: { created: 1000000000000, updated: 1000000001000 },
      }
      const messages = [
        {
          info: {
            id: "msg_1",
            sessionID: "ses_abc123",
            role: "assistant" as const,
            agent: "build",
            modelID: "claude-sonnet-4-20250514",
            providerID: "anthropic",
            mode: "",
            parentID: "msg_0",
            path: { cwd: "/test", root: "/test" },
            cost: 0.001,
            tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
            time: { created: 1000000000100, completed: 1000000000600 },
          },
          parts: [{ id: "p1", sessionID: "ses_abc123", messageID: "msg_1", type: "text" as const, text: "Response" }],
        },
      ]
      const options = { thinking: false, toolDetails: false, assistantMetadata: false }

      const result = formatTranscript(session, messages, options)

      expect(result).toContain("## Assistant\n\n")
      expect(result).not.toContain("Build")
      expect(result).not.toContain("claude-sonnet-4-20250514")
    })
  })

  describe("closure evidence consumers", () => {
    test("keeps closure evidence out of human actions and navigation without relaxing generic filters", () => {
      const rows = closureRows()
      expect(rows.map((row) => isHumanUserMessage(row.info, row.parts))).toEqual([false, true, true, true, true])
      expect(rows.map((row) => isMessageNavigationStop(row.info, row.parts))).toEqual([
        false,
        true,
        false,
        false,
        false,
      ])
      expect(rows.map((row) => transcriptStatus(row.info, row.parts))).toEqual([
        "idle",
        "working",
        "working",
        "working",
        "working",
      ])
    })

    test("a completed async receipt cannot keep an idle child spinner live", () => {
      expect(taskSpinnerRunning("completed", true, { type: "busy" })).toBe(true)
      expect(taskSpinnerRunning("completed", true, { type: "idle" })).toBe(false)
      expect(taskSpinnerRunning("completed", false, { type: "busy" })).toBe(false)
      expect(taskSpinnerRunning("running", false, { type: "idle" })).toBe(true)
    })

    test("production render, action, boundary, status, fork, and copy/export paths call the tested decisions", () => {
      const index = readFileSync(fileURLToPath(new URL("../../src/routes/session/index.tsx", import.meta.url)), "utf8")
      const transcript = region(index, "<For each={messages()}>", "function UserMessage")
      const closure = region(transcript, "<Match when={closureEvidencePart", "<Match when={message.id === revert()")
      expect(closure).toContain("<BranchClosureMessage")
      expect(closure).not.toContain("DialogMessage")
      expect(transcript.indexOf("closureEvidencePart")).toBeLessThan(transcript.indexOf('message.role === "user"'))
      expect(transcript).toContain("DialogMessage")
      const closureRow = region(index, "function BranchClosureMessage", "function UserMessage")
      expect(closureRow).toContain("theme.textMuted")
      expect(closureRow).not.toContain("onMouseUp")
      const humanRow = region(index, "function UserMessage", "function AssistantMessage")
      expect(humanRow).toContain('x.type === "text" && !x.synthetic')

      const undo = region(index, 'value: "session.undo"', 'value: "session.redo"')
      const redo = region(index, 'value: "session.redo"', 'value: "session.sidebar.toggle"')
      const reverted = region(index, "const revertRevertedMessages", "const revert = createMemo")
      expect(undo).toContain("isHumanUserMessage")
      expect(redo).toContain("isHumanUserMessage")
      expect(reverted).toContain("isHumanUserMessage")
      expect(index).toContain("isMessageNavigationStop(message, parts)")
      expect(index).toContain("taskSpinnerRunning(props.part.state.status")
      const decisions = readFileSync(
        fileURLToPath(new URL("../../src/util/closure-record.ts", import.meta.url)),
        "utf8",
      )
      const navigation = region(
        decisions,
        "export function isMessageNavigationStop",
        "export function transcriptStatus",
      )
      expect(navigation).toContain("if (isCompleteClosurePair({ info: message, parts })) return false")
      expect(navigation.indexOf("isCompleteClosurePair")).toBeLessThan(navigation.indexOf("parts.some"))

      const dialog = readFileSync(
        fileURLToPath(new URL("../../src/routes/session/dialog-message.tsx", import.meta.url)),
        "utf8",
      )
      expect(dialog).toContain("isHumanUserMessage(value")
      expect(dialog.indexOf(".filter(() => actionable())")).toBeGreaterThan(dialog.indexOf('title: "Fork"'))
      expect(dialog).toContain('title: "Fork"')

      const fork = readFileSync(
        fileURLToPath(new URL("../../src/routes/session/dialog-fork-from-timeline.tsx", import.meta.url)),
        "utf8",
      )
      expect(fork).toContain("if (!isHumanUserMessage(message, parts)) continue")
      expect(fork).toContain("!x.synthetic && !x.ignored")

      const timeline = readFileSync(
        fileURLToPath(new URL("../../src/routes/session/dialog-timeline.tsx", import.meta.url)),
        "utf8",
      )
      const options = region(timeline, "const options = createMemo", "return <DialogSelect")
      expect(options).toContain("if (!isHumanUserMessage(message, parts)) continue")
      expect(options).toContain("!x.synthetic && !x.ignored")

      const prompt = readFileSync(
        fileURLToPath(new URL("../../src/component/prompt/index.tsx", import.meta.url)),
        "utf8",
      )
      const lastUser = region(prompt, "const lastUserMessage = createMemo", "const [store, setStore]")
      expect(lastUser).toContain("isHumanUserMessage(m, sync.data.part[m.id] ?? [])")
      expect(lastUser).not.toContain('m.role === "user"')

      const sync = readFileSync(fileURLToPath(new URL("../../src/context/sync.tsx", import.meta.url)), "utf8")
      expect(region(sync, "status(sessionID: string)", "async sync(sessionID: string)")).toContain("transcriptStatus(")

      const copy = region(index, 'value: "session.copy"', 'value: "session.export"')
      const exportBlock = region(index, 'value: "session.export"', 'value: "session.background"')
      expect(copy).toContain("formatTranscript(")
      expect(exportBlock).toContain("formatTranscript(")
    })
  })
})
