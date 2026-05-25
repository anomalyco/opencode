import z from "zod"
import { Tool } from "./tool"
import { Question } from "../question"
import DESCRIPTION from "./question.txt"
import { Log } from "@/util/log"

function extractBase64(url: string): string {
  // Recursively strip all data URL prefixes to get pure base64
  const comma = url.indexOf(",")
  if (comma === -1) return url
  const body = url.slice(comma + 1)
  if (!body.startsWith("data:")) return body
  return extractBase64(body)
}

function dataUrl(url: string, mime: string) {
  // If already a complete data URL, extract and rebuild
  if (url.startsWith("data:")) {
    const base64 = extractBase64(url)
    return `data:${mime};base64,${base64}`
  }
  // If pure base64, add prefix
  return `data:${mime};base64,${url}`
}

function format(part: Question.Part) {
  if (typeof part === "string") return part
  return part.filename ? `[image: ${part.filename}]` : "[image]"
}

function file(part: Question.Part) {
  if (typeof part === "string") return
  const result = dataUrl(part.url, part.mime)
  return {
    type: "file" as const,
    mime: part.mime,
    url: result,
    filename: part.filename,
  }
}

export const QuestionTool = Tool.define("question", {
  description: DESCRIPTION,
  parameters: z.object({
    questions: z.array(Question.Info.omit({ custom: true })).describe("Questions to ask"),
  }),
  async execute(params, ctx) {
    const log = Log.create({ service: "tool.question" })
    const start = performance.now()
    log.info("tool-freeze question tool ask start", {
      sessionID: ctx.sessionID,
      messageID: ctx.messageID,
      callID: ctx.callID,
      questions: params.questions.length,
    })
    const answers = await Question.ask({
      sessionID: ctx.sessionID,
      questions: params.questions,
      tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
    })
    log.info("tool-freeze question tool ask end", {
      sessionID: ctx.sessionID,
      messageID: ctx.messageID,
      callID: ctx.callID,
      questions: params.questions.length,
      took: Math.round(performance.now() - start),
    })

    function formatAnswer(answer: Question.Answer | undefined) {
      if (!answer?.length) return "Unanswered"
      return answer.map(format).join(", ")
    }

    const formatted = params.questions.map((q, i) => `"${q.question}"="${formatAnswer(answers[i])}"`).join(", ")
    const attachments = answers.flatMap((answer) =>
      answer.flatMap((part) => {
        const next = file(part)
        return next ? [next] : []
      }),
    )
    log.info("tool-freeze question tool output ready", {
      sessionID: ctx.sessionID,
      messageID: ctx.messageID,
      callID: ctx.callID,
      questions: params.questions.length,
      attachments: attachments.length,
      took: Math.round(performance.now() - start),
    })

    return {
      title: `Asked ${params.questions.length} question${params.questions.length > 1 ? "s" : ""}`,
      output: `User has answered your questions: ${formatted}. You can now continue with the user's answers in mind.`,
      metadata: {
        answers,
      },
      attachments,
    }
  },
})
