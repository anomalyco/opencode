import { autocomplete, intro, outro, spinner } from "@clack/prompts"
import { Effect, Option } from "effect"
import type { IntegrationInfo } from "@opencode-ai/client"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { handlePromptErrors, prompt, requireInteractive } from "../../../ui/prompt"
import { createClient, loadIntegrations, location, request, resolveIntegration } from "./shared"

export default Runtime.handler(
  Commands.commands.auth.commands.logout,
  Effect.fn("cli.auth.logout")((input) =>
    logout({
      target: Option.getOrUndefined(input.target),
      server: Option.getOrUndefined(input.server),
      standalone: input.standalone,
    }).pipe(handlePromptErrors),
  ),
)

const logout = Effect.fn("cli.auth.logout.run")(function* (input: {
  target?: string
  server?: string
  standalone: boolean
}) {
  if (!input.target)
    yield* requireInteractive("Pass an integration ID or name when running without an interactive terminal")
  intro("Remove credential")
  const client = yield* createClient({ server: input.server, standalone: input.standalone })
  const integrations = yield* loadIntegrations(client)
  const integration = yield* chooseIntegration(integrations, input.target)
  const credentials = integration.connections.filter((connection) => connection.type === "credential")
  if (credentials.length === 0) {
    const environment = integration.connections
      .filter((connection) => connection.type === "env")
      .map((connection) => connection.name)
    if (environment.length) {
      yield* Effect.fail(
        new Error(
          `${integration.name} is authenticated through ${environment.join(", ")}; unset the environment variable to disconnect`,
        ),
      )
    }
    yield* Effect.fail(new Error(`No stored credentials for ${integration.name}`))
  }
  const progress = spinner()
  progress.start("Removing credential...")
  yield* Effect.forEach(
    credentials,
    (connection) =>
      request((signal) => client.credential.remove({ credentialID: connection.id, location }, { signal })),
    { concurrency: "unbounded", discard: true },
  ).pipe(
    Effect.tap(() => Effect.sync(() => progress.stop(`Disconnected from ${integration.name}`))),
    Effect.tapCause(() => Effect.sync(() => progress.stop("Failed to remove credential", 1))),
  )
  outro("Done")
})

const chooseIntegration = Effect.fn("cli.auth.logout.integration")(function* (
  integrations: IntegrationInfo[],
  target?: string,
) {
  if (target) return yield* resolveIntegration(integrations, target)
  const configured = integrations.filter((integration) =>
    integration.connections.some((connection) => connection.type === "credential"),
  )
  if (configured.length === 0) return yield* Effect.fail(new Error("No stored credentials found"))
  const id = yield* prompt<string>(() =>
    autocomplete({
      message: "Select integration",
      maxItems: 8,
      options: configured.map((integration) => ({
        value: integration.id,
        label: integration.name,
        hint: integration.connections
          .filter((connection) => connection.type === "credential")
          .map((connection) => connection.label)
          .join(", "),
      })),
    }),
  )
  return yield* resolveIntegration(configured, id)
})
