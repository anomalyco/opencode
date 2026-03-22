#!/usr/bin/env bun
/**
 * Inspect or auto-reply to pending OpenCode question tool calls.
 */

import { parseArgs } from "util"
import { json, pub, resolve } from "./server"

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

type Answer = string[]

function fail(error: string) {
  console.log(JSON.stringify({ success: false, error }, null, 2))
  process.exit(1)
}

function pick(q: QuestionRequest, answer?: string): Answer[] {
  return q.questions.map((item) => {
    if (answer && item.options.some((opt) => opt.label === answer)) return [answer]
    return [item.options[0]?.label || "任务完成"]
  })
}

function parse(input?: string) {
  if (!input) return
  try {
    const value = JSON.parse(input) as unknown
    if (
      !Array.isArray(value) ||
      !value.every((item) => Array.isArray(item) && item.every((part) => typeof part === "string"))
    ) {
      fail('--ANSWERS must be a JSON string like [["继续提问"],["任务完成"]]')
    }
    return value as Answer[]
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err))
  }
}

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    SESSION_ID: { type: "string" },
    REQUEST_ID: { type: "string" },
    PORT: { type: "string" },
    USERNAME: { type: "string" },
    PASSWORD: { type: "string" },
    PREFER_DESKTOP: { type: "boolean", default: true },
    REPLY_FIRST: { type: "boolean", default: false },
    ANSWER: { type: "string" },
    ANSWERS: { type: "string" },
    help: { type: "boolean", short: "h" },
  },
})

if (values.help) {
  console.error(
    "Usage: bun run scripts/opencode_questions.ts [--SESSION_ID ses_xxx] [--REQUEST_ID question_xxx] [--REPLY_FIRST] [--ANSWER '任务完成'] [--ANSWERS '[[\"继续提问\"],[\"任务完成\"]]'] [--PORT 4098]",
  )
  process.exit(0)
}

if (values.ANSWERS && !values.REPLY_FIRST) {
  fail("--ANSWERS requires --REPLY_FIRST")
}

const target = await resolve({
  port: values.PORT ? parseInt(values.PORT, 10) : undefined,
  username: values.USERNAME,
  password: values.PASSWORD,
  preferDesktop: values.PREFER_DESKTOP !== false,
  sessionID: values.SESSION_ID,
})

let questions: QuestionRequest[] = []
try {
  questions = await json<QuestionRequest[]>(target, "/question")
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
}
const filtered = questions.filter((q) => {
  if (values.REQUEST_ID && q.id !== values.REQUEST_ID) return false
  if (values.SESSION_ID && q.sessionID !== values.SESSION_ID) return false
  return true
})

if (!values.REPLY_FIRST) {
  console.log(
    JSON.stringify({ success: true, server: pub(target), count: filtered.length, questions: filtered }, null, 2),
  )
  process.exit(0)
}

const input = parse(values.ANSWERS)
if (input && filtered.length !== 1) {
  fail("--ANSWERS requires exactly one matched pending question; use --REQUEST_ID or --SESSION_ID")
}

const results = [] as any[]
for (const q of filtered) {
  const answers = input ?? pick(q, values.ANSWER)
  if (answers.length !== q.questions.length) {
    fail(`Question ${q.id} expects ${q.questions.length} answers but got ${answers.length}`)
  }

  const replyResp = await json(target, `/question/${q.id}/reply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ answers }),
  }).catch((error) => ({ success: false, error: error.message || String(error) }))

  results.push({
    question_id: q.id,
    session_id: q.sessionID,
    answers,
    response: replyResp,
  })
}

console.log(JSON.stringify({ success: true, server: pub(target), count: results.length, results }, null, 2))
