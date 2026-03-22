#!/usr/bin/env bun
/**
 * OpenCode Bridge Script for Claude Agent Skills.
 */

import { parseArgs } from "util"
import { json, pub, req, resolve, type PublicTarget, type Target } from "./server"

interface BridgeArgs {
  PROMPT: string
  SESSION_ID?: string
  PORT?: number
  USERNAME?: string
  PASSWORD?: string
  TIMEOUT: number
  EXTRACT_TEXT: boolean
  FULL_RESPONSE: boolean
  AUTO_REPLY_QUESTION: boolean
  SAFE_RESUME: boolean
  PREFER_DESKTOP: boolean
}

interface QuestionRequest {
  id: string
  sessionID: string
  questions: Array<{
    header: string
    multiple: boolean
    options: Array<{ label: string; description: string }>
    question: string
  }>
  tool: { messageID: string; callID: string }
}

interface BridgeResponse {
  success: boolean
  session_id?: string
  message_id?: string
  model?: string
  response?: string
  parts?: any[]
  metadata?: any
  question?: {
    seen: boolean
    auto_replied: boolean
    pending: QuestionRequest[]
    replied: Array<{
      id: string
      answers: string[][]
    }>
  }
  safety?: {
    checked: boolean
    aborted_existing_run: boolean
    auto_replied_before_prompt: boolean
    pending_questions_before_prompt: number
    latest_assistant_before_prompt?: {
      id?: string
      finish?: string
      has_error: boolean
      text_length: number
      tool_states: string[]
    }
  }
  server?: PublicTarget
  error?: string
}

type SafetyInfo = NonNullable<BridgeResponse["safety"]>

async function pendingQuestions(target: Target, sessionId: string) {
  const questions = await json<QuestionRequest[]>(target, "/question")
  return questions.filter((q) => q.sessionID === sessionId)
}

async function replyToPendingQuestions(target: Target, sessionId: string) {
  const mine = await pendingQuestions(target, sessionId)
  const replied: Array<{ id: string; answers: string[][] }> = []
  for (const q of mine) {
    const answers = q.questions.map((question) => [question.options[0]?.label || "任务完成"])
    await json(target, `/question/${q.id}/reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answers }),
    })
    replied.push({ id: q.id, answers })
    process.stderr.write(`Auto-replied to question: ${q.id}\n`)
  }
  return { pending: mine, replied }
}

function extractText(parts: any[]): string {
  return (parts || [])
    .filter((p: any) => p.type === "text")
    .map((p: any) => p.text)
    .join("\n")
}

function cleanResponse(text: string): string {
  const lines = text.split("\n")
  const clean = [] as string[]
  let found = false
  for (const line of lines) {
    if (!found) {
      if (
        line.startsWith("- collaborating-with-") ||
        line.startsWith("- do-calculus") ||
        line.startsWith("- do-algebra") ||
        line.startsWith("- opencode-interact") ||
        line.trim() === "No skills needed" ||
        line.trim() === "No skills needed." ||
        line.trim() === ""
      ) {
        continue
      }
      found = true
    }
    clean.push(line)
  }
  return clean.join("\n").trim()
}

function assistantSummary(msg: any) {
  return {
    id: msg?.info?.id,
    finish: msg?.info?.finish,
    has_error: Boolean(msg?.info?.error),
    text_length: extractText(msg?.parts || []).length,
    tool_states: (msg?.parts || [])
      .filter((part: any) => part.type === "tool")
      .map((part: any) => `${part.tool}:${part.state?.status || "unknown"}`),
  }
}

async function sendPrompt(args: BridgeArgs): Promise<BridgeResponse> {
  let target: Target | undefined
  const question = {
    seen: false,
    auto_replied: false,
    pending: [] as QuestionRequest[],
    replied: [] as Array<{ id: string; answers: string[][] }>,
  }
  const safety: SafetyInfo = {
    checked: false,
    aborted_existing_run: false,
    auto_replied_before_prompt: false,
    pending_questions_before_prompt: 0,
    latest_assistant_before_prompt: undefined,
  }

  try {
    target = await resolve({
      port: args.PORT,
      username: args.USERNAME,
      password: args.PASSWORD,
      preferDesktop: args.PREFER_DESKTOP,
      sessionID: args.SESSION_ID,
    })

    let sessionId = args.SESSION_ID
    if (!sessionId) {
      const session = await json<any>(target, "/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      })
      sessionId = session.id
      process.stderr.write(`Session created: ${sessionId}\n`)
    }

    if (args.SAFE_RESUME) {
      safety.checked = true
      const pending = await pendingQuestions(target, sessionId!)
      safety.pending_questions_before_prompt = pending.length
      if (pending.length > 0 && args.AUTO_REPLY_QUESTION) {
        const next = await replyToPendingQuestions(target, sessionId!)
        if (next.pending.length > 0) {
          safety.auto_replied_before_prompt = true
          question.seen = true
          question.auto_replied = true
          question.pending = next.pending
          question.replied.push(...next.replied)
        }
      }

      const before = await json<any[]>(target, `/session/${sessionId}/message`)
      const latest = before.filter((msg: any) => msg.info.role === "assistant").at(-1)
      if (latest) {
        safety.latest_assistant_before_prompt = assistantSummary(latest)
        const busy = (latest.parts || []).some(
          (part: any) =>
            part.type === "tool" && part.tool !== "question" && ["pending", "running"].includes(part.state?.status),
        )
        const unfinished = !latest.info?.finish || ["tool-calls", "unknown"].includes(latest.info.finish)
        if (busy || unfinished) {
          const resp = await req(target, `/session/${sessionId}/abort`, { method: "POST" })
          if (!resp.ok) {
            throw new Error(`Failed to abort stuck run before prompt: HTTP ${resp.status}: ${await resp.text()}`)
          }
          safety.aborted_existing_run = true
        }
      }
    }

    const existing = await json<any[]>(target, `/session/${sessionId}/message`)
    const count = existing.filter((msg: any) => msg.info.role === "assistant").length

    await req(target, `/session/${sessionId}/prompt_async`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parts: [{ type: "text", text: args.PROMPT }] }),
    })
    process.stderr.write("Prompt sent\n")

    const step = 2000
    const max = Math.ceil(args.TIMEOUT / step)
    let size = 0
    let stable = 0

    for (let i = 0; i < max; i++) {
      await new Promise((done) => setTimeout(done, step))

      if (args.AUTO_REPLY_QUESTION) {
        const next = await replyToPendingQuestions(target, sessionId!)
        if (next.pending.length > 0) {
          question.seen = true
          question.auto_replied = true
          question.pending = next.pending
          question.replied.push(...next.replied)
        }
      } else {
        const pending = await pendingQuestions(target, sessionId!)
        if (pending.length > 0) {
          question.seen = true
          question.pending = pending
        }
      }

      const msgs = await json<any[]>(target, `/session/${sessionId}/message`)
      const assistants = msgs.filter((msg: any) => msg.info.role === "assistant")
      if (assistants.length <= count) continue

      const latest = assistants.at(-1)
      const text = extractText(latest.parts)
      const running = (latest.parts || [])
        .filter((part: any) => part.type === "tool")
        .some((part: any) => part.tool !== "question" && part.state?.status === "running")

      if (text.length <= 10 || running) continue
      if (text.length === size) {
        stable++
        if (stable >= 3) {
          const result: BridgeResponse = {
            success: true,
            session_id: sessionId,
            message_id: latest.info.id,
            model: latest.info.modelID,
            response: args.EXTRACT_TEXT ? cleanResponse(text) : text,
            question,
            safety,
            server: pub(target),
          }
          if (args.FULL_RESPONSE) {
            result.parts = latest.parts
            result.metadata = {
              created: latest.info.time?.created,
              completed: latest.info.time?.completed,
              tokens: latest.info.tokens,
              cost: latest.info.cost,
            }
          }
          return result
        }
        continue
      }

      stable = 0
      size = text.length
    }

    return {
      success: false,
      session_id: sessionId,
      question,
      safety,
      server: pub(target),
      error: `Timeout after ${args.TIMEOUT}ms waiting for response`,
    }
  } catch (error: any) {
    return {
      success: false,
      question,
      safety,
      server: target ? pub(target) : undefined,
      error: error.message || String(error),
    }
  }
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      PROMPT: { type: "string" },
      SESSION_ID: { type: "string" },
      PORT: { type: "string" },
      USERNAME: { type: "string" },
      PASSWORD: { type: "string" },
      TIMEOUT: { type: "string" },
      EXTRACT_TEXT: { type: "boolean", default: true },
      FULL_RESPONSE: { type: "boolean", default: false },
      AUTO_REPLY_QUESTION: { type: "boolean", default: true },
      SAFE_RESUME: { type: "boolean", default: true },
      PREFER_DESKTOP: { type: "boolean", default: true },
      help: { type: "boolean", short: "h" },
    },
    strict: true,
  })

  if (values.help) {
    console.log(`
OpenCode Bridge - Interact with OpenCode AI via existing server

Usage:
  bun run opencode_bridge.ts --PROMPT "Your question" [OPTIONS]

Required:
  --PROMPT <string>              The prompt/question to send to OpenCode AI

Optional:
  --SESSION_ID <string>          Resume existing session for multi-turn conversation
  --PORT <number>                Override server port manually
  --USERNAME <string>            Basic auth username for manual port mode
  --PASSWORD <string>            Basic auth password for manual port mode
  --TIMEOUT <number>             Response timeout in milliseconds (default: 180000)
  --EXTRACT_TEXT                 Extract only text parts from response (default: true)
  --FULL_RESPONSE                Return complete response with all parts and metadata
  --no-AUTO_REPLY_QUESTION       Disable auto-replying to question tool calls
  --no-SAFE_RESUME               Skip preflight question-clear and abort checks
  --no-PREFER_DESKTOP            Skip desktop bridge discovery and prefer standalone fallback
  -h, --help                     Show this help message

Examples:
  bun run opencode_bridge.ts --PROMPT "今天几号？"
  bun run opencode_bridge.ts --SESSION_ID "ses_xxx" --PROMPT "明天呢？"
  bun run opencode_bridge.ts --SESSION_ID "ses_xxx" --PROMPT "继续刚才的话题" --SAFE_RESUME
  bun run opencode_bridge.ts --PROMPT "Hello" --PORT 49529
  bun run opencode_bridge.ts --PROMPT "Hello" --PORT 52216 --PASSWORD "secret"
  bun run opencode_bridge.ts --PROMPT "分析这段代码" --FULL_RESPONSE
`)
    process.exit(0)
  }

  if (!values.PROMPT) throw new Error("--PROMPT is required")

  const result = await sendPrompt({
    PROMPT: values.PROMPT,
    SESSION_ID: values.SESSION_ID,
    PORT: values.PORT ? parseInt(values.PORT, 10) : undefined,
    USERNAME: values.USERNAME,
    PASSWORD: values.PASSWORD,
    TIMEOUT: values.TIMEOUT ? parseInt(values.TIMEOUT, 10) : 180000,
    EXTRACT_TEXT: values.EXTRACT_TEXT !== false,
    FULL_RESPONSE: values.FULL_RESPONSE ?? false,
    AUTO_REPLY_QUESTION: values.AUTO_REPLY_QUESTION !== false,
    SAFE_RESUME: values.SAFE_RESUME !== false,
    PREFER_DESKTOP: values.PREFER_DESKTOP !== false,
  })

  console.log(JSON.stringify(result, null, 2))
  process.exit(result.success ? 0 : 1)
}

main().catch((error) => {
  console.log(JSON.stringify({ success: false, error: error.message || String(error) }, null, 2))
  process.exit(1)
})
