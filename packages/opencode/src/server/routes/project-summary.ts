import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import { generateObject } from "ai"
import z from "zod"
import { Session } from "../../session"
import { MessageV2 } from "../../session/message-v2"
import { SessionID } from "@/session/schema"
import { ModelID, ProviderID } from "@/provider/schema"
import { Provider } from "../../provider/provider"
import { errors } from "../error"
import { lazy } from "../../util/lazy"

const ProjectSummary = z
  .object({
    title: z.string(),
    description: z.string(),
    usage: z.string(),
  })
  .meta({ ref: "ProjectSummary" })

export const ProjectSummaryRoutes = lazy(() =>
  new Hono().post(
    "/generate",
    describeRoute({
      summary: "Generate project summary",
      description:
        "Summarize the given session into a public-gallery project summary (title, description, usage). Runs in the background and is not appended to the session message stream.",
      operationId: "projectSummary.generate",
      responses: {
        200: {
          description: "Generated summary",
          content: {
            "application/json": {
              schema: resolver(ProjectSummary),
            },
          },
        },
        ...errors(400, 404),
      },
    }),
    validator(
      "json",
      z.object({
        sessionID: SessionID.zod,
        providerID: ProviderID.zod.optional(),
        modelID: ModelID.zod.optional(),
      }),
    ),
    async (c) => {
      const body = c.req.valid("json")
      const msgs = await Session.messages({ sessionID: body.sessionID })

      let providerID = body.providerID
      let modelID = body.modelID
      if (!providerID || !modelID) {
        for (let i = msgs.length - 1; i >= 0; i--) {
          const info = msgs[i].info
          if (info.role === "user") {
            providerID = info.model.providerID
            modelID = info.model.modelID
            break
          }
        }
      }
      if (!providerID || !modelID) {
        const def = await Provider.defaultModel()
        providerID = def.providerID
        modelID = def.modelID
      }

      const info = await Provider.getModel(providerID, modelID)
      const language = await Provider.getLanguage(info)

      const transcript = msgs
        .map((m) => {
          const text = m.parts
            .filter((p): p is MessageV2.TextPart => p.type === "text")
            .map((p) => p.text)
            .join("\n")
          return text.trim().length > 0 ? `[${m.info.role}] ${text}` : ""
        })
        .filter((line) => line.length > 0)
        .join("\n\n")

      const { object } = await generateObject({
        model: language,
        schema: ProjectSummary,
        system:
          "You generate concise project summaries from coding session transcripts. Respond in the language used by the user in the transcript.",
        prompt: `Generate a short project summary based on this transcript. Fields:
- title: under 60 chars, what the project is
- description: 1-2 sentences, what was built
- usage: 1-2 sentences, how to run or use it

Transcript:
${transcript || "(empty session)"}`,
      })

      return c.json(object)
    },
  ),
)
