import type { ServerAuthConfig } from "./config"
import { ServerAuthBasic } from "./basic"
import { ServerAuthOidc } from "./oidc"
import { ServerAuthSession } from "./session"

export type Result =
  | { type: "disabled" }
  | { type: "basic"; username: string }
  | { type: "oidc"; subject: string; email?: string; name?: string; groups?: string[] }

export class Unauthorized extends Error {
  constructor(message = "Unauthorized") {
    super(message)
    this.name = "Unauthorized"
  }
}

export async function request(config: ServerAuthConfig.Info, input: Request): Promise<Result> {
  if (config.mode === "disabled") return { type: "disabled" }
  if (config.mode === "basic") {
    if (
      ServerAuthBasic.verify(
        config.basic,
        input.headers.get("authorization"),
        new URL(input.url).searchParams.get("auth_token"),
      )
    ) {
      return { type: "basic", username: config.basic.username }
    }
    throw new Unauthorized()
  }

  const session = ServerAuthSession.parse(
    config.session,
    ServerAuthSession.readCookie(input.headers.get("cookie"), config.session.cookieName),
  )
  if (session) {
    return {
      type: "oidc",
      subject: session.subject,
      email: session.email,
      name: session.name,
      groups: session.groups,
    }
  }

  const authorization = input.headers.get("authorization")
  if (authorization?.startsWith("Bearer ")) {
    const identity = await ServerAuthOidc.verifyBearerToken(config.oidc, authorization.slice("Bearer ".length))
    return {
      type: "oidc",
      subject: identity.subject,
      email: identity.email,
      name: identity.name,
      groups: identity.groups,
    }
  }
  throw new Unauthorized()
}

export function wantsJson(input: Request) {
  const accept = input.headers.get("accept") ?? ""
  return accept.includes("application/json") || input.headers.get("content-type")?.includes("application/json") === true
}

export * as ServerAuthVerify from "./verify"
