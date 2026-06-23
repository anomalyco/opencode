import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./personal-contacts.txt"

export const Parameters = Schema.Struct({
  action: Schema.Literal("list", "get", "create", "update", "delete", "search"),
  id: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
  email: Schema.optional(Schema.String),
  phone: Schema.optional(Schema.String),
  notes: Schema.optional(Schema.String),
  query: Schema.optional(Schema.String),
})

function formatContact(c: { id: string; name: string; email?: string | null; phone?: string | null; notes?: string | null; time_created: number; time_updated: number }) {
  return [
    `## ${c.name}`,
    `ID: ${c.id}`,
    `Email: ${c.email ?? "N/A"}`,
    `Phone: ${c.phone ?? "N/A"}`,
    `Notes: ${c.notes ?? "N/A"}`,
    `Created: ${new Date(c.time_created).toISOString()}`,
    `Updated: ${new Date(c.time_updated).toISOString()}`,
  ].join("\n")
}

export const PersonalContactsTool = Tool.define(
  "personal_contacts",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          const { Contacts } = yield* Effect.promise(() => import("@opencode-ai/core/personal/contacts"))
          const svc = yield* Contacts

          switch (params.action) {
            case "list": {
              const contacts = yield* svc.list()
              const output = contacts.length === 0
                ? "No contacts found."
                : contacts.map((c: any) => `- ${c.name}${c.email ? ` <${c.email}>` : ""}${c.phone ? ` (${c.phone})` : ""}`).join("\n")
              return { title: `${contacts.length} contato(s)`, output }
            }
            case "get": {
              if (!params.id) return yield* Effect.fail(new Error("id is required for get action"))
              const contact = yield* svc.get(params.id)
              if (!contact) return yield* Effect.fail(new Error("Contact not found"))
              return { title: contact.name, output: formatContact(contact) }
            }
            case "create": {
              if (!params.name) return yield* Effect.fail(new Error("name is required for create action"))
              const contact = yield* svc.create({
                name: params.name,
                email: params.email,
                phone: params.phone,
                notes: params.notes,
              })
              return { title: "Contato criado", output: formatContact(contact) }
            }
            case "update": {
              if (!params.id) return yield* Effect.fail(new Error("id is required for update action"))
              const contact = yield* svc.update(params.id, {
                name: params.name,
                email: params.email,
                phone: params.phone,
                notes: params.notes,
              })
              return { title: "Contato atualizado", output: formatContact(contact) }
            }
            case "delete": {
              if (!params.id) return yield* Effect.fail(new Error("id is required for delete action"))
              yield* svc.delete(params.id)
              return { title: "Contato removido", output: `Contato ${params.id} removido com sucesso.` }
            }
            case "search": {
              if (!params.query) return yield* Effect.fail(new Error("query is required for search action"))
              const contacts = yield* svc.search(params.query)
              const output = contacts.length === 0
                ? "No contacts found matching the query."
                : contacts.map((c: any) => `- ${c.name}${c.email ? ` <${c.email}>` : ""}`).join("\n")
              return { title: `${contacts.length} contato(s) encontrado(s)`, output }
            }
          }
        }),
    }
  }),
)
