import { Context, Effect, Layer } from "effect"
import { UserProfile } from "./profile"

export interface SmtpConfig {
  host: string
  port: number
  secure: boolean
  user: string
  pass: string
  from: string
}

export interface EmailOptions {
  cc?: string[]
  bcc?: string[]
  attachments?: { filename: string; content: string }[]
}

export interface Interface {
  readonly send: (to: string, subject: string, body: string, options?: EmailOptions) => Effect.Effect<void>
  readonly getConfig: () => Effect.Effect<SmtpConfig | null>
  readonly setConfig: (config: SmtpConfig) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Email") {}

export const layer = Layer.effect(Service, Effect.gen(function* () {
  const profile = yield* UserProfile

  const getConfig = Effect.gen(function* () {
    const p = yield* profile.get
    const prefs = p.preferences as any
    if (prefs.smtp) return prefs.smtp as SmtpConfig
    return null
  })

  const setConfig = (config: SmtpConfig) =>
    Effect.gen(function* () {
      const p = yield* profile.get
      const prefs = { ...p.preferences, smtp: config }
      yield* profile.update({ preferences: prefs })
    })

  return Service.of({
    send: (to, subject, body, options) =>
      Effect.gen(function* () {
        const config = yield* getConfig
        if (!config) return yield* Effect.fail(new Error("SMTP not configured"))

        const nodemailer = yield* Effect.promise(() =>
          import("nodemailer").catch(() => {
            throw new Error("nodemailer package is not installed. Run: npm install nodemailer")
          }),
        )

        const transporter = nodemailer.default.createTransport({
          host: config.host,
          port: config.port,
          secure: config.secure,
          auth: { user: config.user, pass: config.pass },
        })

        yield* Effect.promise(() =>
          transporter.sendMail({
            from: config.from,
            to,
            subject,
            text: body,
            cc: options?.cc?.join(", "),
            bcc: options?.bcc?.join(", "),
            attachments: options?.attachments as any,
          }),
        )
      }),
    getConfig,
    setConfig,
  })
}))

export const defaultLayer = layer.pipe(
  Layer.provide(UserProfile.defaultLayer),
)

export { Service as Email }
