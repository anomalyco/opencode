import { Schema } from "effect"
import { zod } from "@/util/effect-zod"
import { PositiveInt, withStatics } from "@/util/schema"

const AuthMode = Schema.Literals(["disabled", "basic", "oidc"])

const ServerAuth = Schema.Struct({
  mode: Schema.optional(AuthMode).annotate({
    description:
      "Server authentication mode. Defaults to basic when OPENCODE_SERVER_PASSWORD is set, otherwise disabled.",
  }),
  basic: Schema.optional(
    Schema.Struct({
      username: Schema.optional(Schema.String).annotate({ description: "Basic auth username" }),
      password: Schema.optional(Schema.String).annotate({ description: "Basic auth password" }),
    }),
  ),
  oidc: Schema.optional(
    Schema.Struct({
      issuer: Schema.String.annotate({ description: "OIDC issuer URL" }),
      clientID: Schema.String.annotate({ description: "OIDC client ID" }),
      clientSecret: Schema.optional(Schema.String).annotate({ description: "OIDC client secret" }),
      redirectURI: Schema.optional(Schema.String).annotate({ description: "OIDC callback redirect URI" }),
      scopes: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
        description: "OIDC scopes. Defaults to openid profile email.",
      }),
      audience: Schema.optional(Schema.Union([Schema.String, Schema.mutable(Schema.Array(Schema.String))])).annotate({
        description: "Accepted JWT audience for API bearer tokens",
      }),
      allowedEmails: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
        description: "Email addresses allowed to access this server",
      }),
      allowedDomains: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
        description: "Email domains allowed to access this server",
      }),
      allowedGroups: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
        description: "Groups allowed to access this server",
      }),
      usernameClaim: Schema.optional(Schema.String).annotate({ description: "Claim to use as the display username" }),
      groupsClaim: Schema.optional(Schema.String).annotate({ description: "Claim containing group memberships" }),
      requireEmailVerified: Schema.optional(Schema.Boolean).annotate({
        description: "Require email_verified=true in OIDC claims",
      }),
    }),
  ),
  session: Schema.optional(
    Schema.Struct({
      secret: Schema.optional(Schema.String).annotate({ description: "Secret used to sign browser auth sessions" }),
      cookieName: Schema.optional(Schema.String).annotate({ description: "OIDC session cookie name" }),
      cookieSecure: Schema.optional(Schema.Boolean).annotate({ description: "Force Secure session cookies" }),
      ttlSeconds: Schema.optional(PositiveInt).annotate({ description: "Session TTL in seconds" }),
    }),
  ),
})

export const Server = Schema.Struct({
  port: Schema.optional(PositiveInt).annotate({
    description: "Port to listen on",
  }),
  hostname: Schema.optional(Schema.String).annotate({ description: "Hostname to listen on" }),
  mdns: Schema.optional(Schema.Boolean).annotate({ description: "Enable mDNS service discovery" }),
  mdnsDomain: Schema.optional(Schema.String).annotate({
    description: "Custom domain name for mDNS service (default: opencode.local)",
  }),
  cors: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
    description: "Additional domains to allow for CORS",
  }),
  auth: Schema.optional(ServerAuth).annotate({ description: "Server authentication configuration" }),
})
  .annotate({ identifier: "ServerConfig" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type Server = Schema.Schema.Type<typeof Server>

export * as ConfigServer from "./server"
