import { z } from "zod"
import { and, eq, getTableColumns, isNull, sql } from "drizzle-orm"
import { fn } from "./util/fn"
import { Database } from "./drizzle"
import { UserRole, UserTable } from "./schema/user.sql"
import { Actor } from "./actor"
import { Identifier } from "./identifier"
import { render } from "@jsx-email/render"
import { AWS } from "./aws"
import { Account } from "./account"
import { AccountTable } from "./schema/account.sql"
import { Key } from "./key"
import { KeyTable } from "./schema/key.sql"

export namespace User {
  const assertAdmin = () => {
    if (Actor.userRole() === "admin") return
    throw new Error(`Expected admin user, got ${Actor.userRole()}`)
  }

  const assertNotSelf = (id: string) => {
    if (Actor.userID() !== id) return
    throw new Error(`Expected not self actor, got self actor`)
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

  export const getAccountEmail = fn(z.string(), (id) =>
    Database.use((tx) =>
      tx
        .select({
          email: AccountTable.email,
        })
        .from(UserTable)
        .leftJoin(AccountTable, eq(UserTable.accountID, AccountTable.id))
        .where(and(eq(UserTable.workspaceID, Actor.workspace()), eq(UserTable.id, id)))
        .then((rows) => rows[0]?.email),
    ),
  )

  export const invite = fn(
    z.object({
      email: z.string(),
      role: z.enum(UserRole),
    }),
    async ({ email, role }) => {
      assertAdmin()
      const workspaceID = Actor.workspace()

      // create user
      const account = await Account.fromEmail(email)
      await Database.use((tx) =>
        tx
          .insert(UserTable)
          .values({
            id: Identifier.create("user"),
            name: "",
            ...(account
              ? {
                  accountID: account.id,
                }
              : {
                  email,
                }),
            workspaceID,
            role,
          })
          .onDuplicateKeyUpdate({
            set: {
              role,
              timeDeleted: null,
            },
          }),
      )

      // create api key
      if (account) {
        await Database.use(async (tx) => {
          const user = await tx
            .select()
            .from(UserTable)
            .where(and(eq(UserTable.workspaceID, workspaceID), eq(UserTable.accountID, account.id)))
            .then((rows) => rows[0])

          const key = await tx
            .select()
            .from(KeyTable)
            .where(and(eq(KeyTable.workspaceID, workspaceID), eq(KeyTable.userID, user.id)))
            .then((rows) => rows[0])

          if (key) return

          await Key.create({ userID: user.id, name: "Default API Key" })
        })
      }

      // send email, ignore errors
      try {
        const { InviteEmail } = await import("@opencode-ai/console-mail/InviteEmail.jsx")
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

  export const joinInvitedWorkspaces = fn(z.void(), async () => {
    const account = Actor.assert("account")
    const invitations = await Database.use(async (tx) => {
      const invitations = await tx
        .select({
          id: UserTable.id,
          workspaceID: UserTable.workspaceID,
        })
        .from(UserTable)
        .where(eq(UserTable.email, account.properties.email))

      await tx
        .update(UserTable)
        .set({
          accountID: account.properties.accountID,
          email: null,
        })
        .where(eq(UserTable.email, account.properties.email))
      return invitations
    })

    await Promise.all(
      invitations.map((invite) =>
        Actor.provide(
          "system",
          {
            workspaceID: invite.workspaceID,
          },
          () => Key.create({ userID: invite.id, name: "Default API Key" }),
        ),
      ),
    )
  })

  export const update = fn(
    z.object({
      id: z.string(),
      role: z.enum(UserRole),
      monthlyLimit: z.number().nullable(),
    }),
    async ({ id, role, monthlyLimit }) => {
      assertAdmin()
      if (role === "member") assertNotSelf(id)
      return await Database.use((tx) =>
        tx
          .update(UserTable)
          .set({ role, monthlyLimit })
          .where(and(eq(UserTable.id, id), eq(UserTable.workspaceID, Actor.workspace()))),
      )
    },
  )

  export const remove = fn(z.string(), async (id) => {
    assertAdmin()
    assertNotSelf(id)

    return await Database.use((tx) =>
      tx
        .update(UserTable)
        .set({
          timeDeleted: sql`now()`,
        })
        .where(and(eq(UserTable.id, id), eq(UserTable.workspaceID, Actor.workspace()))),
    )
  })
}
