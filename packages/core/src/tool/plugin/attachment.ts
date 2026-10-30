export * as AttachmentTool from "./attachment.js"

import type { Context } from "@opencode/plugin/effect/plugin"
import { Effect, Schema } from "effect"
import { ProjectAttachments } from "../../workspace-manager/attachments.js"
import { Location } from "../../location.js"

export const name = "project_attachment"

export const Input = Schema.Struct({
  action: Schema.Literals(["list", "read", "search"]).annotate({
    description: "Action to perform: 'list' (list attachments), 'read' (read attachment text/summary), or 'search' (search attachments).",
  }),
  idOrName: Schema.optional(Schema.String).annotate({
    description: "The ID or filename of the attachment to read. Required for 'read'.",
  }),
  query: Schema.optional(Schema.String).annotate({
    description: "Query term to filter or search attachments. Required for 'search'.",
  }),
})

export const Output = Schema.Struct({
  success: Schema.Boolean,
  message: Schema.String,
  data: Schema.optional(Schema.Unknown),
})

export const description = [
  "Interact with persistent project attachments (uploaded documents, specifications, data spreadsheets, diagrams, and files).",
  "Use action 'list' to view all persistent documents and files attached to this project.",
  "Use action 'read' with 'idOrName' to read the full text or extracted summary of an attachment.",
  "Use action 'search' with 'query' to search through attachment titles and extracted summaries.",
].join("\n")

export const Plugin = {
  id: "opencode.tool.attachment",
  effect: Effect.fn("AttachmentTool.Plugin")(function* (ctx: Context) {
    const location = yield* Location.Service
    const attachments = yield* ProjectAttachments.Service

    yield* ctx.tool.transform((editor) =>
      editor.add({
        name,
        options: { codemode: false },
        description,
        input: Input,
        output: Output,
        execute: (input) =>
          Effect.gen(function* () {
            const projectID = location.project.id

            if (input.action === "list") {
              const list = yield* attachments.list(projectID)
              const out = {
                success: true,
                message: `Found ${list.length} project attachments.`,
                data: list.map((a) => ({
                  id: a.id,
                  name: a.name,
                  category: a.category,
                  size: a.size,
                  summary: a.extractedSummary,
                })),
              }
              return {
                output: out,
                content: `${out.message}\n` + list.map((a) => `- ${a.name} (${a.category}, ${a.size} bytes)`).join("\n"),
              }
            }

            if (input.action === "read") {
              if (!input.idOrName) {
                const out = {
                  success: false,
                  message: "Missing 'idOrName' parameter for read action.",
                }
                return { output: out, content: out.message }
              }

              const all = yield* attachments.list(projectID)
              const match = all.find((a) => a.id === input.idOrName || a.name.toLowerCase() === input.idOrName?.toLowerCase())
              if (!match) {
                const out = {
                  success: false,
                  message: `Attachment "${input.idOrName}" not found in project.`,
                }
                return { output: out, content: out.message }
              }

              const content = yield* attachments.readContent(projectID, match.id).pipe(
                Effect.orElseSucceed(() => undefined),
              )

              const body = content ?? match.extractedSummary ?? "(No content readable)"
              const out = {
                success: true,
                message: `Loaded attachment: ${match.name}`,
                data: {
                  attachment: match,
                  content: body,
                },
              }
              return {
                output: out,
                content: `### Attachment: ${match.name}\n\n${body}`,
              }
            }

            if (input.action === "search") {
              const query = input.query ?? ""
              const results = yield* attachments.search(projectID, query)
              const out = {
                success: true,
                message: `Found ${results.length} attachments matching "${query}".`,
                data: results.map((r) => ({
                  id: r.id,
                  name: r.name,
                  category: r.category,
                  summary: r.extractedSummary,
                })),
              }
              return {
                output: out,
                content: `${out.message}\n` + results.map((r) => `- ${r.name}: ${r.extractedSummary ?? ""}`).join("\n"),
              }
            }

            const out = {
              success: false,
              message: `Unknown action: ${input.action}`,
            }
            return { output: out, content: out.message }
          }),
      }),
    )
  }),
}
