import { Schema } from "effect"

export const Token = Schema.Union([
  Schema.String,
  Schema.TemplateLiteral(["env:", Schema.String]),
])
// Token allows either a literal string ("123456:ABC") or env reference ("env:TELEGRAM_BOT_TOKEN")

export const Telegram = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean).annotate({
    description: "Enable Telegram integration",
  }),
  token: Schema.optional(Token).annotate({
    description: "Bot token, or env:VAR to read from environment",
  }),
  directory: Schema.optional(Schema.String).annotate({
    description: "Working directory for the Telegram bot",
  }),
}).annotate({ identifier: "IntegrationTelegram" })
export type Telegram = Schema.Schema.Type<typeof Telegram>

export const Slack = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean).annotate({
    description: "Enable Slack integration",
  }),
  token: Schema.optional(Token).annotate({
    description: "Bot token, or env:VAR to read from environment",
  }),
  signingSecret: Schema.optional(Token).annotate({
    description: "Signing secret, or env:VAR to read from environment",
  }),
  appToken: Schema.optional(Token).annotate({
    description: "App-level token, or env:VAR to read from environment",
  }),
}).annotate({ identifier: "IntegrationSlack" })
export type Slack = Schema.Schema.Type<typeof Slack>

export const Integrations = Schema.Struct({
  telegram: Schema.optional(Telegram),
  slack: Schema.optional(Slack),
}).annotate({ identifier: "Integrations" })
export type Integrations = Schema.Schema.Type<typeof Integrations>

export function resolveToken(token: string): string | undefined {
  if (token.startsWith("env:")) {
    return process.env[token.slice(4)]
  }
  return token
}

export * as ConfigIntegration from "./integration"
