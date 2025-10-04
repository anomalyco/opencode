import { z } from "zod"
import { and, eq, getTableColumns, inArray, isNull, or, sql } from "drizzle-orm"
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
      await assertAdmin()
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
      //if (account) {
      //  const existing = await Database.use(tx => {
      //    const key = tx.select().from(KeyTable).where(and(eq(KeyTable.workspaceID, workspaceID), eq(KeyTable, account.id))).then((rows) => rows[0])
      //    return key
      //  })
      //}

      // send email, ignore errors
      try {
        const { InviteEmail } = await import("@opencode/console-mail/InviteEmail.jsx")
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
          () => Key.create({ name: "Default API Key" }),
        ),
      ),
    )

    return invitations.length
  })

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
