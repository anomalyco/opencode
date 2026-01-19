import type { KVNamespace } from "@cloudflare/workers-types"
import { z } from "zod"
import { issuer } from "@openauthjs/openauth"
import type { Theme } from "@openauthjs/openauth/ui/theme"
import { createSubjects } from "@openauthjs/openauth/subject"
import { THEME_OPENAUTH } from "@openauthjs/openauth/ui/theme"
import { GithubProvider } from "@openauthjs/openauth/provider/github"
import { GoogleOidcProvider } from "@openauthjs/openauth/provider/google"
import { CloudflareStorage } from "@openauthjs/openauth/storage/cloudflare"
import { Account } from "@opencode-ai/console-core/account.js"
import { Workspace } from "@opencode-ai/console-core/workspace.js"
import { Actor } from "@opencode-ai/console-core/actor.js"
import { Resource } from "@opencode-ai/console-resource"
import { User } from "@opencode-ai/console-core/user.js"
import { and, Database, eq, isNull, or } from "@opencode-ai/console-core/drizzle/index.js"
import { WorkspaceTable } from "@opencode-ai/console-core/schema/workspace.sql.js"
import { UserTable } from "@opencode-ai/console-core/schema/user.sql.js"
import { AuthTable } from "@opencode-ai/console-core/schema/auth.sql.js"
import { Identifier } from "@opencode-ai/console-core/identifier.js"

type Env = {
  AuthStorage: KVNamespace
}

export const subjects = createSubjects({
  account: z.object({
    accountID: z.string(),
    email: z.string(),
  }),
  user: z.object({
    userID: z.string(),
    workspaceID: z.string(),
  }),
})

const MY_THEME: Theme = {
  ...THEME_OPENAUTH,
  logo: "https://opencode.ai/favicon.svg",
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const result = await issuer({
      theme: MY_THEME,
      providers: {
        github: GithubProvider({
          clientID: Resource.GITHUB_CLIENT_ID_CONSOLE.value,
          clientSecret: Resource.GITHUB_CLIENT_SECRET_CONSOLE.value,
          scopes: ["read:user", "user:email"],
        }),
        google: GoogleOidcProvider({
          clientID: Resource.GOOGLE_CLIENT_ID.value,
          scopes: ["openid", "email"],
        }),
        //        email: CodeProvider({
        //          async request(req, state, form, error) {
        //            console.log(state)
        //            const params = new URLSearchParams()
        //            if (error) {
        //              params.set("error", error.type)
        //            }
        //            if (state.type === "start") {
        //              return Response.redirect(process.env.AUTH_FRONTEND_URL + "/auth/email?" + params.toString(), 302)
        //            }
        //
        //            if (state.type === "code") {
        //              return Response.redirect(process.env.AUTH_FRONTEND_URL + "/auth/code?" + params.toString(), 302)
        //            }
        //
        //            return new Response("ok")
        //          },
        //          async sendCode(claims, code) {
        //            const email = z.string().email().parse(claims.email)
        //            const cmd = new SendEmailCommand({
        //              Destination: {
        //                ToAddresses: [email],
        //              },
        //              FromEmailAddress: `SST <auth@${Resource.Email.sender}>`,
        //              Content: {
        //                Simple: {
        //                  Body: {
        //                    Html: {
        //                      Data: `Your pin code is <strong>${code}</strong>`,
        //                    },
        //                    Text: {
        //                      Data: `Your pin code is ${code}`,
        //                    },
        //                  },
        //                  Subject: {
        //                    Data: "SST Console Pin Code: " + code,
        //                  },
        //                },
        //              },
        //            })
        //            await ses.send(cmd)
        //          },
        //        }),
      },
      storage: CloudflareStorage({
        // @ts-ignore
        namespace: env.AuthStorage,
      }),
      subjects,
      async success(ctx, response) {
        console.log(response)

        let subject: string | undefined
        let email: string | undefined

        if (response.provider === "github") {
          const emails = (await fetch("https://api.github.com/user/emails", {
            headers: {
              Authorization: `Bearer ${response.tokenset.access}`,
              "User-Agent": "opencode",
              Accept: "application/vnd.github+json",
            },
          }).then((x) => x.json())) as any
          const user = (await fetch("https://api.github.com/user", {
            headers: {
              Authorization: `Bearer ${response.tokenset.access}`,
              "User-Agent": "opencode",
              Accept: "application/vnd.github+json",
            },
          }).then((x) => x.json())) as any
          subject = user.id.toString()

          const primaryEmail = emails.find((x: any) => x.primary)
          if (!primaryEmail) throw new Error("No primary email found for GitHub user")
          if (!primaryEmail.verified) throw new Error("Primary email for GitHub user not verified")
          email = primaryEmail.email
        } else if (response.provider === "google") {
          if (!response.id.email_verified) throw new Error("Google email not verified")
          subject = response.id.sub as string
          email = response.id.email as string
        } else throw new Error("Unsupported provider")

        if (!email) throw new Error("No email found")
        if (!subject) throw new Error("No subject found")

        if (Resource.App.stage !== "production" && !email.endsWith("@anoma.ly")) {
          throw new Error("Invalid email")
        }

        // Get account
        const accountID = await (async () => {
          const matches = await Database.use(async (tx) =>
            tx
              .select({
                provider: AuthTable.provider,
                accountID: AuthTable.accountID,
              })
              .from(AuthTable)
              .where(
                or(
                  and(eq(AuthTable.provider, response.provider), eq(AuthTable.subject, subject)),
                  and(eq(AuthTable.provider, "email"), eq(AuthTable.subject, email)),
                ),
              ),
          )
          const idByProvider = matches.find((x) => x.provider === response.provider)?.accountID
          const idByEmail = matches.find((x) => x.provider === "email")?.accountID
          if (idByProvider && idByEmail) return idByProvider

          // create account if not found
          let accountID = idByProvider ?? idByEmail
          if (!accountID) {
            console.log("creating account for", email)
            accountID = await Account.create({})
          }

          await Database.use(async (tx) =>
            tx
              .insert(AuthTable)
              .values([
                {
                  id: Identifier.create("auth"),
                  accountID,
                  provider: response.provider,
                  subject,
                },
                {
                  id: Identifier.create("auth"),
                  accountID,
                  provider: "email",
                  subject: email,
                },
              ])
              .onDuplicateKeyUpdate({
                set: {
                  timeDeleted: null,
                },
              }),
          )

          return accountID
        })()

        // Get workspace
        await Actor.provide("account", { accountID, email }, async () => {
          await User.joinInvitedWorkspaces()
          const workspaces = await Database.use((tx) =>
            tx
              .select({ id: WorkspaceTable.id })
              .from(WorkspaceTable)
              .innerJoin(UserTable, eq(UserTable.workspaceID, WorkspaceTable.id))
              .where(
                and(
                  eq(UserTable.accountID, accountID),
                  isNull(UserTable.timeDeleted),
                  isNull(WorkspaceTable.timeDeleted),
                ),
              ),
          )
          if (workspaces.length === 0) {
            await Workspace.create({ name: "Default" })
          }
        })
        return ctx.subject("account", accountID, { accountID, email })
      },
    }).fetch(request, env, ctx)
    return result
  },
}
