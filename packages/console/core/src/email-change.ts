import { render } from "@jsx-email/render"
import { z } from "zod"
import { and, Database, eq, isNull, or, sql } from "./drizzle"
import { Actor } from "./actor"
import { AWS } from "./aws"
import { fn } from "./util/fn"
import { Identifier } from "./identifier"
import { AuthTable } from "./schema/auth.sql"
import { EmailChangeTable } from "./schema/email-change.sql"

const EXPIRY_HOURS = 24
const CONSOLE_URL = "https://opencode.ai"

const email = z.string().email().max(255).transform((value) => value.toLowerCase())

const token = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url")
const hash = async (value: string) =>
  Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))).toString("hex")

export namespace EmailChange {
  export function nextConfirmationState(input: {
    oldTokenHash: string
    newTokenHash: string
    tokenHash: string
    oldConfirmedAt: Date | null
    newConfirmedAt: Date | null
    now: Date
  }) {
    const oldConfirmedAt = input.oldTokenHash === input.tokenHash ? input.now : input.oldConfirmedAt
    const newConfirmedAt = input.newTokenHash === input.tokenHash ? input.now : input.newConfirmedAt
    return {
      oldConfirmedAt,
      newConfirmedAt,
      complete: !!oldConfirmedAt && !!newConfirmedAt,
    }
  }

  export const request = fn(z.object({ newEmail: email }), async (input) => {
    const actor = Actor.assert("account")
    const newEmail = input.newEmail

    const oldToken = token()
    const newToken = token()
    const id = Identifier.create("emailChange")
    const oldEmail = await Database.transaction(async (tx) => {
      const current = await tx
        .select({ email: AuthTable.subject })
        .from(AuthTable)
        .where(
          and(
            eq(AuthTable.provider, "email"),
            eq(AuthTable.accountID, actor.properties.accountID),
            isNull(AuthTable.timeDeleted),
          ),
        )
        .then((rows) => rows[0])
      if (!current) throw new Error("Current email not found")
      if (newEmail === current.email) throw new Error("New email must be different from current email")

      const existing = await tx
        .select({ accountID: AuthTable.accountID })
        .from(AuthTable)
        .where(and(eq(AuthTable.provider, "email"), eq(AuthTable.subject, newEmail)))
        .then((rows) => rows[0])
      if (existing) throw new Error("Email is already in use")

      await tx
        .update(EmailChangeTable)
        .set({ cancelledAt: sql`now()` })
        .where(
          and(
            eq(EmailChangeTable.accountID, actor.properties.accountID),
            isNull(EmailChangeTable.completedAt),
            isNull(EmailChangeTable.cancelledAt),
          ),
        )

      await tx.insert(EmailChangeTable).values({
        id,
        accountID: actor.properties.accountID,
        oldEmail: current.email,
        newEmail,
        oldTokenHash: await hash(oldToken),
        newTokenHash: await hash(newToken),
        expiresAt: sql`DATE_ADD(now(), INTERVAL ${EXPIRY_HOURS} HOUR)`,
      })
      return current.email
    })

    const { EmailChangeConfirmEmail } = await import("@opencode-ai/console-mail/EmailChangeConfirmEmail.jsx")
    const oldUrl = `${CONSOLE_URL}/account/email/confirm/${oldToken}`
    const newUrl = `${CONSOLE_URL}/account/email/confirm/${newToken}`

    await Promise.all([
      AWS.sendEmail({
        to: oldEmail,
        subject: "Confirm your OpenCode email change",
        body: render(
          // @ts-ignore
          EmailChangeConfirmEmail({ oldEmail, newEmail, url: oldUrl, kind: "old" }),
        ),
      }),
      AWS.sendEmail({
        to: newEmail,
        subject: "Verify your new OpenCode email",
        body: render(
          // @ts-ignore
          EmailChangeConfirmEmail({ oldEmail, newEmail, url: newUrl, kind: "new" }),
        ),
      }),
    ])
  })

  export const confirm = fn(z.object({ token: z.string().min(1) }), async (input) => {
    const tokenHash = await hash(input.token)
    return Database.transaction(async (tx) => {
      const change = await tx
        .select()
        .from(EmailChangeTable)
        .where(
          and(
            or(eq(EmailChangeTable.oldTokenHash, tokenHash), eq(EmailChangeTable.newTokenHash, tokenHash)),
            isNull(EmailChangeTable.completedAt),
            isNull(EmailChangeTable.cancelledAt),
          ),
        )
        .then((rows) => rows[0])
      if (!change) throw new Error("Email change request not found")
      if (change.expiresAt < new Date()) throw new Error("Email change request expired")

      const next = nextConfirmationState({
        oldTokenHash: change.oldTokenHash,
        newTokenHash: change.newTokenHash,
        tokenHash,
        oldConfirmedAt: change.oldConfirmedAt,
        newConfirmedAt: change.newConfirmedAt,
        now: new Date(),
      })

      await tx
        .update(EmailChangeTable)
        .set({ oldConfirmedAt: next.oldConfirmedAt, newConfirmedAt: next.newConfirmedAt })
        .where(eq(EmailChangeTable.id, change.id))

      if (!next.complete) return { complete: false, email: change.newEmail }

      const existing = await tx
        .select({ accountID: AuthTable.accountID })
        .from(AuthTable)
        .where(and(eq(AuthTable.provider, "email"), eq(AuthTable.subject, change.newEmail)))
        .then((rows) => rows[0])
      if (existing && existing.accountID !== change.accountID) throw new Error("Email is already in use")

      await tx
        .update(AuthTable)
        .set({ subject: change.newEmail })
        .where(and(eq(AuthTable.provider, "email"), eq(AuthTable.accountID, change.accountID)))

      await tx.update(EmailChangeTable).set({ completedAt: sql`now()` }).where(eq(EmailChangeTable.id, change.id))
      return { complete: true, email: change.newEmail }
    })
  })
}
