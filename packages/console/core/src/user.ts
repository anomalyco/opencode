import { z } from "zod"
import { and, eq, getTableColumns, isNull, sql } from "drizzle-orm"
import { fn } from "./util/fn"
import { Database } from "./drizzle"
import { UserRole, UserTable } from "./schema/user.sql"
import { Actor } from "./actor"
import { Identifier } from "./identifier"
import { render } from "@jsx-email/render"
import { AWS } from "./aws"
import { Key } from "./key"
import { KeyTable } from "./schema/key.sql"
import { WorkspaceTable } from "./schema/workspace.sql"
import { AuthTable } from "./schema/auth.sql"

export namespace User {
  const assertNotSelf = (id: string) => {
    if (Actor.userID() !== id) return
    throw new Error(`Expected not self actor, got self actor`)
  }

  export const list = fn(z.void(), () =>
    Database.use((tx) =>
      tx
        .select({
          ...getTableColumns(UserTable),
          authEmail: AuthTable.subject,
        })
        .from(UserTable)
        .leftJoin(AuthTable, and(eq(UserTable.accountID, AuthTable.accountID), eq(AuthTable.provider, "email")))
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

  export const getAuthEmail = fn(z.string(), (id) =>
    Database.use((tx) =>
      tx
        .select({
          email: AuthTable.subject,
        })
        .from(UserTable)
        .leftJoin(AuthTable, and(eq(UserTable.accountID, AuthTable.accountID), eq(AuthTable.provider, "email")))
        .where(and(eq(UserTable.workspaceID, Actor.workspace()), eq(UserTable.id, id)))
        .then((rows) => rows[0]?.email),
    ),
  )

  export const invite = fn(
    z.object({
      email: z.string(),
      role: z.enum(UserRole),
      monthlyLimit: z.number().nullable().optional(),
    }),
    async ({ email, role, monthlyLimit }) => {
      Actor.assertAdmin()
      const workspaceID = Actor.workspace()

      // create user
      const accountID = await Database.use((tx) =>
        tx
          .select({
            accountID: AuthTable.accountID,
          })
          .from(AuthTable)
          .where(and(eq(AuthTable.provider, "email"), eq(AuthTable.subject, email)))
          .then((rows) => rows[0]?.accountID),
      )
      await Database.use((tx) =>
        tx
          .insert(UserTable)
          .values({
            id: Identifier.create("user"),
            name: "",
            ...(accountID
              ? {
                  accountID,
                }
              : {
                  email,
                }),
            workspaceID,
            role,
            monthlyLimit,
          })
          .onDuplicateKeyUpdate({
            set: {
              role,
              monthlyLimit,
              timeDeleted: null,
            },
          }),
      )

      // create api key
      if (accountID) {
        await Database.use(async (tx) => {
          const user = await tx
            .select()
            .from(UserTable)
            .where(and(eq(UserTable.workspaceID, workspaceID), eq(UserTable.accountID, accountID)))
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
        const emailInfo = await Database.use((tx) =>
          tx
            .select({
              inviterEmail: AuthTable.subject,
              workspaceName: WorkspaceTable.name,
            })
            .from(UserTable)
            .innerJoin(AuthTable, and(eq(UserTable.accountID, AuthTable.accountID), eq(AuthTable.provider, "email")))
            .innerJoin(WorkspaceTable, eq(WorkspaceTable.id, workspaceID))
            .where(
              and(eq(UserTable.workspaceID, workspaceID), eq(UserTable.id, Actor.assert("user").properties.userID)),
            )
            .then((rows) => rows[0]),
        )

        const { InviteEmail } = await import("@opencode-ai/console-mail/InviteEmail.jsx")
        await AWS.sendEmail({
          to: email,
          subject: `You've been invited to join the ${emailInfo.workspaceName} workspace on OpenCode`,
          body: render(
            // @ts-ignore
            InviteEmail({
              inviter: emailInfo.inviterEmail,
              assetsUrl: `https://opencode.ai/email`,
              workspaceID: workspaceID,
              workspaceName: emailInfo.workspaceName,
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
      Actor.assertAdmin()
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
    Actor.assertAdmin()
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
