import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./askuserquestion.txt"
import { AskUserNext } from "../askuser"

export const AskUserQuestionTool = Tool.define("askuserquestion", {
  description: DESCRIPTION,
  parameters: z.object({
    questions: z
      .array(
        z.object({
          question: z.string().describe("The question to ask the user"),
          header: z.string().max(12).describe("Short label for tab display (max 12 chars)"),
          options: z
            .array(
              z.object({
                label: z.string().describe("The option label"),
                description: z.string().describe("Description of what this option means"),
              }),
            )
            .min(2)
            .max(4)
            .describe("Available options (2-4). An 'Other' option is always added automatically."),
          multiSelect: z.boolean().describe("Whether the user can select multiple options"),
        }),
      )
      .min(1)
      .max(4)
      .describe("Questions to ask the user (1-4 questions)"),
  }),
  async execute(params, ctx) {
    const reply = await AskUserNext.ask({
      sessionID: ctx.sessionID,
      questions: params.questions,
      tool: ctx.callID
        ? {
            messageID: ctx.messageID,
            callID: ctx.callID,
          }
        : undefined,
    })

    const output = formatReply(params.questions, reply)

    return {
      title: `${params.questions.length} question${params.questions.length > 1 ? "s" : ""} answered`,
      output,
      metadata: {
        questions: params.questions,
        answers: reply.answers,
      },
    }
  },
})

function formatReply(questions: AskUserNext.Question[], reply: AskUserNext.Reply): string {
  const lines: string[] = []

  for (const answer of reply.answers) {
    const question = questions[answer.questionIndex]
    if (!question) continue

    lines.push(`## ${question.header}`)
    lines.push(`Question: ${question.question}`)
    lines.push("")

    if (answer.otherText !== undefined && answer.otherText !== "") {
      lines.push(`Answer: ${answer.otherText}`)
    } else {
      const selectedLabels = answer.selectedIndices
        .map((i) => question.options[i]?.label)
        .filter(Boolean)
      lines.push(`Answer: ${selectedLabels.join(", ")}`)
    }
    lines.push("")
  }

  return lines.join("\n")
}
