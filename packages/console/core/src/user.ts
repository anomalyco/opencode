import { z } from "zod"
import { and, eq, getTableColumns, isNull, sql } from "drizzle-orm"
import { fn } from "./util/fn"
import { Database } from "./drizzle"
import { UserRole, UserTable } from "./schema/user.sql"
import { Actor } from "./actor"
import { Identifier } from "./identifier"
import { render } from "@jsx-email/render"
import { InviteEmail } from "@opencode/console-mail/InviteEmail.jsx"
import { AWS } from "./aws"
import { Account } from "./account"
import { AccountTable } from "./schema/account.sql"

export namespace User {
  const assertAdmin = async () => {
    const actor = Actor.assert("user")
    const user = await User.fromID(actor.properties.userID)
    if (user?.role !== "admin") {
      throw new Error(`Expected admin user, got ${user?.role}`)
    }
  }

  const assertNotSelf = (id: string) => {
    const actor = Actor.assert("user")
    if (actor.properties.userID === id) {
      throw new Error(`Expected not self actor, got self actor`)
    }
  }

  export const list = fn(z.void(), () =>
    Database.use((tx) =>
      tx
        .select({
          ...getTableColumns(UserTable),
          accountEmail: AccountTable.email,
        })
        .from(UserTable)
        .leftJoin(AccountTable, eq(UserTable.accountID, AccountTable.id))
        .where(and(eq(UserTable.workspaceID, Actor.workspace()), isNull(UserTable.timeDeleted))),
    ),
  )

  export const fromID = fn(z.string(), (id) =>
    Database.use((tx) =>
      tx
        .select()
        .from(UserTable)
        .where(and(eq(UserTable.workspaceID, Actor.workspace()), eq(UserTable.id, id), isNull(UserTable.timeDeleted)))
        .then((rows) => rows[0]),
    ),
  )

  export const invite = fn(
    z.object({
      email: z.string(),
      role: z.enum(UserRole),
    }),
    async ({ email, role }) => {
      await assertAdmin()

      const workspaceID = Actor.workspace()
      await Database.transaction(async (tx) => {
        const account = await Account.fromEmail(email)
        const members = await tx.select().from(UserTable).where(eq(UserTable.workspaceID, Actor.workspace()))

        await (async () => {
          if (account) {
            // case: account previously invited and removed
            if (members.some((m) => m.oldAccountID === account.id)) {
              await tx
                .update(UserTable)
                .set({
                  timeDeleted: null,
                  oldAccountID: null,
                  accountID: account.id,
                })
                .where(and(eq(UserTable.workspaceID, Actor.workspace()), eq(UserTable.accountID, account.id)))
              return
            }
            // case: account previously not invited
            await tx
              .insert(UserTable)
              .values({
                id: Identifier.create("user"),
                name: "",
                accountID: account.id,
                workspaceID,
                role,
              })
              .catch((e: any) => {
                if (e.message.match(/Duplicate entry '.*' for key 'user.user_account_id'/))
                  throw new Error("A user with this email has already been invited.")
                throw e
              })
            return
          }
          // case: email previously invited and removed
          if (members.some((m) => m.oldEmail === email)) {
            await tx
              .update(UserTable)
              .set({
                timeDeleted: null,
                oldEmail: null,
                email,
              })
              .where(and(eq(UserTable.workspaceID, Actor.workspace()), eq(UserTable.email, email)))
            return
          }
          // case: email previously not invited
          await tx
            .insert(UserTable)
            .values({
              id: Identifier.create("user"),
              name: "",
              email,
              workspaceID,
              role,
            })
            .catch((e: any) => {
              if (e.message.match(/Duplicate entry '.*' for key 'user.user_email'/))
                throw new Error("A user with this email has already been invited.")
              throw e
            })
        })()
      })

      // send email, ignore errors
      try {
        await AWS.sendEmail({
          to: email,
          subject: `You've been invited to join the ${workspaceID} workspace on OpenCode Zen`,
          body: render(
            // @ts-ignore
            InviteEmail({
              assetsUrl: `https://opencode.ai/email`,
              workspace: workspaceID,
            }),
          ),
        })
      } catch (e) {
        console.error(e)
      }
    },
  )

  export const updateRole = fn(
    z.object({
      id: z.string(),
      role: z.enum(UserRole),
    }),
    async ({ id, role }) => {
      await assertAdmin()
      if (role === "member") assertNotSelf(id)
      return await Database.use((tx) =>
        tx
          .update(UserTable)
          .set({ role })
          .where(and(eq(UserTable.id, id), eq(UserTable.workspaceID, Actor.workspace()))),
      )
    },
  )

  export const remove = fn(z.string(), async (id) => {
    await assertAdmin()
    assertNotSelf(id)

    return await Database.transaction(async (tx) => {
      const user = await fromID(id)
      if (!user) throw new Error("User not found")

      await tx
        .update(UserTable)
        .set({
          ...(user.email
            ? {
                oldEmail: user.email,
                email: null,
              }
            : {
                oldAccountID: user.accountID,
                accountID: null,
              }),
          timeDeleted: sql`now()`,
        })
        .where(and(eq(UserTable.id, id), eq(UserTable.workspaceID, Actor.workspace())))
    })
  })
}
