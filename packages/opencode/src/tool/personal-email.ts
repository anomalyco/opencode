import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./personal-email.txt"

export const Parameters = Schema.Struct({
  action: Schema.Literal("send", "config", "set_config"),
  to: Schema.optional(Schema.String),
  subject: Schema.optional(Schema.String),
  body: Schema.optional(Schema.String),
  smtp_host: Schema.optional(Schema.String),
  smtp_port: Schema.optional(Schema.Number),
  smtp_user: Schema.optional(Schema.String),
  smtp_pass: Schema.optional(Schema.String),
})

export const PersonalEmailTool = Tool.define(
  "personal_email",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          const { Email } = yield* Effect.promise(() => import("@opencode-ai/core/personal/email"))
          const svc = yield* Email

          switch (params.action) {
            case "send": {
              if (!params.to || !params.subject || !params.body)
                return yield* Effect.fail(new Error("to, subject, and body are required for send action"))
              yield* svc.send(params.to, params.subject, params.body)
              return { title: "E-mail enviado", output: `Email sent to ${params.to}.` }
            }
            case "config": {
              const cfg = yield* svc.getConfig()
              return {
                title: "Configuração SMTP",
                output: cfg ? JSON.stringify(cfg, null, 2) : "No SMTP configuration set.",
              }
            }
            case "set_config": {
              if (!params.smtp_host || !params.smtp_port || !params.smtp_user || !params.smtp_pass)
                return yield* Effect.fail(new Error("smtp_host, smtp_port, smtp_user, and smtp_pass are required for set_config action"))
              yield* svc.setConfig({
                host: params.smtp_host,
                port: params.smtp_port,
                secure: params.smtp_port === 465,
                user: params.smtp_user,
                pass: params.smtp_pass,
                from: params.smtp_user,
              })
              return { title: "SMTP configurado", output: "SMTP configuration saved." }
            }
          }
        }).pipe(Effect.orDie),
    }
  }),
)
