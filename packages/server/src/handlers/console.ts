import { Config } from "@opencode/core/config"
import { ConsoleAccess } from "@opencode/core/console-access"
import { Flag } from "@opencode/core/flag"
import { Integration } from "@opencode/core/integration"
import { ManagedPolicy } from "@opencode/core/managed-policy"
import { ForbiddenError, ServiceUnavailableError } from "@opencode/protocol/errors"
import { Effect } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpServerResponse } from "effect/http"

export const slackMessage = Effect.fn("server.experimental.console.slackMessage")(function* (
  http: HttpClient.HttpClient,
  url: string,
) {
  if (!(yield* Flag.enabled("console_slack_preview")))
    return yield* new ForbiddenError({ message: "Slack message previews are disabled" })

  const integrations = yield* Integration.Service
  const connection = yield* integrations.connection.active(Integration.ID.make("opencode"))
  const credential =
    connection && (yield* integrations.connection.resolve(connection).pipe(Effect.mapError(unavailable)))
  const headers = { "cache-control": "no-store", "x-content-type-options": "nosniff" }
  if (!credential || credential.type === "external")
    return HttpServerResponse.jsonUnsafe({ status: "unavailable", reason: "no_console" }, { headers })

  const config = yield* Config.Service
  const policy = ManagedPolicy.match(
    ManagedPolicy.statements(yield* config.entries()),
    "integration.use",
    ManagedPolicy.integrationResource("opencode", ManagedPolicy.account(credential)),
  )
  if (policy?.effect === "deny") return yield* new ForbiddenError({ message: policy.message })

  return yield* HttpClient.withScope(http)
    .execute(
      HttpClientRequest.get(`${ConsoleAccess.server(credential)}/api/v2/slack/message`).pipe(
        HttpClientRequest.setUrlParam("url", url),
        HttpClientRequest.setHeaders(ConsoleAccess.headers(credential)),
        HttpClientRequest.acceptJson,
      ),
    )
    .pipe(
      Effect.flatMap((response) =>
        Effect.map(response.text, (body) =>
          HttpServerResponse.text(body, { status: response.status, contentType: "application/json", headers }),
        ),
      ),
      Effect.provideService(FetchHttpClient.RequestInit, { redirect: "error" }),
      Effect.scoped,
      Effect.timeout("15 seconds"),
      Effect.mapError(unavailable),
    )
})

function unavailable() {
  return new ServiceUnavailableError({
    service: "opencode",
    message: "Could not read Slack preview from OpenCode Console",
  })
}
