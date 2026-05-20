// securecode qwen-question-normalize plugin.
//
// Qwen 系モデルが `question` tool の `questions` パラメータを以下のような
// malformed な形式で送ってくる issue (#21 / #67 / #100) を吸収する：
//
// - JSON 文字列 ("\n[{\"question\": \"...\"}]\n")
// - 単一の question オブジェクト（配列ラップ忘れ）
// - bare string（自由入力プロンプトをそのまま渡してくる）
//
// `tool.execute.before` hook が schema decode より前に発火する点を利用し
// （`session/prompt.ts:421-426`、`{ args }` を in-place で変異できる）、
// LLM が送ってきた `args.questions` をここで正規化してから tool runner の
// schema decode に渡す。後続の Effect Schema は upstream と同じ strict な
// `Schema.Array(Question.Prompt)` で OK。
//
// あわせて `tool.definition` hook で LLM に送る `question` tool の description
// に「`questions` を quote するな」という Qwen 向け hint を append する。
// 以前は `packages/opencode/src/tool/question.txt` に直接書かれていたが、
// upstream sync の conflict 面を減らすため plugin 側に集約した (issue #131)。
//
// 関連: issue #119 (Pilot 5) / #131、precedent: PR #102 / #116 と同じ
// `packages/opencode/src/securecode/plugins/` レイアウト。

import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "securecode.qwen-question-normalize" })

const DISABLE_ENV = "SECURECODE_QWEN_QUESTION_NORMALIZE_DISABLE"

const QUESTION_TOOL_ID = "question"

const QWEN_QUESTION_DESCRIPTION_HINT = [
  "- Pass raw JSON values to the tool. Do not wrap the `questions` array in quotes.",
  '- Example: `{"questions":[{"header":"Stack","question":"Which language?","options":[{"label":"TypeScript","description":"Use TypeScript"}]}]}`',
].join("\n")

function trim(input: unknown) {
  return typeof input === "string" ? input.trim() : ""
}

function head(input: string) {
  const value = input.split("\n")[0]?.trim() ?? ""
  if (!value) return "Question"
  if (value.length <= 30) return value
  return value.slice(0, 27).trimEnd() + "..."
}

function parseJSON(input: string) {
  try {
    return JSON.parse(input)
  } catch {
    return undefined
  }
}

function option(input: unknown) {
  if (typeof input === "string") {
    const value = input.trim()
    if (!value) return undefined
    return { label: value, description: value }
  }
  if (!input || typeof input !== "object") return undefined
  const label = trim((input as Record<string, unknown>).label)
  if (!label) return undefined
  return {
    label,
    description: trim((input as Record<string, unknown>).description) || label,
  }
}

function info(input: unknown) {
  if (typeof input === "string") {
    const value = input.trim()
    if (!value) return undefined
    const parsed = parseJSON(value)
    if (parsed !== undefined) return info(parsed)
    return { question: value, header: head(value), options: [] }
  }
  if (!input || typeof input !== "object") return undefined
  const value = input as Record<string, unknown>
  const question = trim(value.question) || trim(value.header)
  if (!question) return undefined
  const options = Array.isArray(value.options) ? value.options.map(option).filter((x) => x !== undefined) : []
  return {
    question,
    header: trim(value.header) || head(question),
    options,
    ...(value.multiple === true ? { multiple: true } : {}),
  }
}

/**
 * 生 input を `[{ question, header, options, multiple? }, ...]` の配列形式へ正規化する。
 * 配列に変換できないほど壊れた input はそのまま返し、後段の schema decode に reject させる。
 */
export function normalizeQuestionsInput(input: unknown): unknown {
  if (typeof input === "string") {
    const value = input.trim()
    if (!value) return input
    const parsed = parseJSON(value)
    if (parsed !== undefined) return normalizeQuestionsInput(parsed)
    const single = info(value)
    return single ? [single] : input
  }
  if (Array.isArray(input)) return input.map(info).filter((x) => x !== undefined)
  const single = info(input)
  if (single) return [single]
  return input
}

export async function QwenQuestionNormalizePlugin(_input: PluginInput): Promise<Hooks> {
  if (process.env[DISABLE_ENV] === "1") {
    log.info("disabled via env", { env: DISABLE_ENV })
    return {}
  }

  return {
    "tool.execute.before": async (input, output) => {
      if (input.tool !== QUESTION_TOOL_ID) return
      const args = output.args as { questions?: unknown } | undefined
      if (!args || !("questions" in args)) return

      const before = args.questions
      const after = normalizeQuestionsInput(before)
      if (after === before) return // already an array of valid prompts (most common case)

      args.questions = after as typeof args.questions
      log.info("normalized question.questions", {
        sessionID: input.sessionID,
        beforeType: typeof before,
        beforeLength: typeof before === "string" ? before.length : Array.isArray(before) ? before.length : "n/a",
        afterLength: Array.isArray(after) ? after.length : "n/a",
      })
    },
    "tool.definition": async (input, output) => {
      if (input.toolID !== QUESTION_TOOL_ID) return
      if (output.description.includes(QWEN_QUESTION_DESCRIPTION_HINT)) return
      output.description = `${output.description.trimEnd()}\n${QWEN_QUESTION_DESCRIPTION_HINT}\n`
    },
  }
}
