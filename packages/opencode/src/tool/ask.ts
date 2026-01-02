import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./ask.txt"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Identifier } from "@/id/id"

const OptionSchema = z.object({
  value: z.string().describe("Unique identifier for this option"),
  label: z.string().describe("Short display label"),
  description: z.string().optional().describe("Detailed explanation of this option"),
})

export type AskOption = z.infer<typeof OptionSchema>

const AskRequestSchema = z.object({
  id: z.string(),
  sessionID: z.string(),
  messageID: z.string(),
  question: z.string(),
  options: OptionSchema.array(),
  context: z.string().optional(),
})

export type AskRequest = z.infer<typeof AskRequestSchema>

const AskResponseSchema = z.object({
  id: z.string(),
  sessionID: z.string(),
  selected: z.string(),
})

export type AskResponse = z.infer<typeof AskResponseSchema>

export namespace AskUser {
  export const Event = {
    Asked: BusEvent.define("askuser.question", AskRequestSchema),
    Answered: BusEvent.define("askuser.answer", AskResponseSchema),
    Cancelled: BusEvent.define(
      "askuser.cancelled",
      z.object({
        id: z.string(),
        sessionID: z.string(),
      }),
    ),
  }
}

export class UserCancelledError extends Error {
  constructor() {
    super(
      "The user cancelled the question. Do not ask the same question again. " +
        "Either proceed with a reasonable default or ask a different, more specific question.",
    )
    this.name = "UserCancelledError"
  }
}

function formatOutput(question: string, selected: AskOption, allOptions: AskOption[]): string {
  const otherOptions = allOptions
    .filter((o) => o.value !== selected.value)
    .map((o) => `- ${o.label}`)
    .join("\n")

  return `## User Response

**Question**: ${question}

**Selected**: ${selected.label}${selected.description ? ` - ${selected.description}` : ""}

**Value**: \`${selected.value}\`

**Rejected alternatives**:
${otherOptions}

---

Proceed with the implementation based on the user's choice of "${selected.label}".`
}

export const AskUserTool = Tool.define<
  z.ZodObject<{
    question: z.ZodString
    options: z.ZodArray<typeof OptionSchema>
    context: z.ZodOptional<z.ZodString>
  }>,
  { question: string; selected: string; label: string }
>("ask_user", {
  description: DESCRIPTION,
  parameters: z.object({
    question: z
      .string()
      .min(10)
      .max(500)
      .describe("The clarifying question to ask the user. Be specific and actionable."),
    options: OptionSchema.array()
      .min(2)
      .max(6)
      .describe("2-6 distinct options for the user to choose from. Each must have unique value."),
    context: z
      .string()
      .max(300)
      .optional()
      .describe("Optional context explaining why this decision matters or its implications."),
  }),

  async execute(params, ctx) {
    const values = params.options.map((o) => o.value)
    if (new Set(values).size !== values.length) {
      throw new Error("Each option must have a unique 'value' field")
    }

    const id = Identifier.ascending("ask")

    const answer = await new Promise<string>((resolve, reject) => {
      const unsubAnswer = Bus.subscribe(AskUser.Event.Answered, (event) => {
        if (event.properties.id === id) {
          cleanup()
          resolve(event.properties.selected)
        }
      })

      const unsubCancel = Bus.subscribe(AskUser.Event.Cancelled, (event) => {
        if (event.properties.id === id) {
          cleanup()
          reject(new UserCancelledError())
        }
      })

      const onAbort = () => {
        cleanup()
        reject(new Error("Session aborted"))
      }
      ctx.abort.addEventListener("abort", onAbort)

      const cleanup = () => {
        unsubAnswer()
        unsubCancel()
        ctx.abort.removeEventListener("abort", onAbort)
      }

      Bus.publish(AskUser.Event.Asked, {
        id,
        sessionID: ctx.sessionID,
        messageID: ctx.messageID,
        question: params.question,
        options: params.options,
        context: params.context,
      })
    })

    const selected = params.options.find((o) => o.value === answer)
    if (!selected) {
      throw new Error(`Invalid selection: ${answer}`)
    }

    ctx.metadata({
      title: `Asked: ${params.question.slice(0, 50)}...`,
      metadata: {
        question: params.question,
        selected: answer,
        label: selected.label,
      },
    })

    return {
      title: `User selected: ${selected.label}`,
      metadata: {
        question: params.question,
        selected: answer,
        label: selected.label,
      },
      output: formatOutput(params.question, selected, params.options),
    }
  },
})
