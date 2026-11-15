import { Schema } from "effect"
import { HttpApiEndpoint, OpenApi } from "effect/http-api"
import { ForbiddenError, ServiceUnavailableError } from "../errors.js"
import { LocationQuery, locationQueryOpenApi } from "./location.js"

const SlackMessage = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("found"),
    message: Schema.Struct({
      permalink: Schema.String,
      channel: Schema.Struct({
        id: Schema.String,
        name: Schema.NullOr(Schema.String),
        kind: Schema.Literals(["public", "private", "dm", "group", "external"]),
      }),
      author: Schema.Struct({ name: Schema.String, avatarUrl: Schema.NullOr(Schema.String) }),
      text: Schema.String,
      ts: Schema.String,
      threadTs: Schema.NullOr(Schema.String),
      replyCount: Schema.Int,
    }),
  }),
  Schema.Struct({
    status: Schema.Literal("unavailable"),
    reason: Schema.Literals(["no_console", "no_slack_connection", "no_access", "not_found", "invalid_url"]),
  }),
]).annotate({ identifier: "Console.SlackMessage" })

export const ConsoleSlackMessageEndpoint = HttpApiEndpoint.get(
  "console.slackMessage",
  "/api/experimental/console/slack/message",
  {
    query: Schema.Struct({ ...LocationQuery.fields, url: Schema.String }),
    success: SlackMessage,
    error: [ForbiddenError, ServiceUnavailableError],
  },
)
  .annotateMerge(locationQueryOpenApi)
  .annotateMerge(
    OpenApi.annotations({
      identifier: "experimental.console.slackMessage",
      summary: "Preview a Slack message",
      description:
        "Read a Slack permalink through the member's OpenCode Console sign-in. Experimental: may change without compatibility guarantees.",
      override: { tags: ["experimental"] },
    }),
  )
