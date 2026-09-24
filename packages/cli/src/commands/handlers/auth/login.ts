import { AutocompletePrompt } from "@clack/core"
import {
  intro,
  log,
  outro,
  select,
  spinner,
  text,
  S_BAR,
  S_BAR_END,
  S_RADIO_ACTIVE,
  S_RADIO_INACTIVE,
  symbol,
} from "@clack/prompts"
import { Effect, Option } from "effect"
import type { FormAnswer, IntegrationInfo, OpenCodeClient } from "@opencode/client"
import color from "picocolors"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { handlePromptErrors, openUrl, prompt, requireInteractive } from "../../../ui/prompt"
import { answerForm, secret } from "./form"
import {
  createClient,
  connectMethods,
  loadIntegrations,
  location,
  request,
  resolveIntegration,
  resolveMethod,
  type ConnectMethod,
} from "./shared"

const integrationPriority = new Map([
  ["opencode-go", 0],
  ["opencode", 1],
  ["openai", 2],
  ["github-copilot", 3],
  ["anthropic", 4],
  ["google", 5],
])

type LoginChoice = {
  value: string
  label: string
  category: "MCP" | "Popular" | "Services"
  connected: boolean
}

export default Runtime.handler(
  Commands.commands.auth.commands.login,
  Effect.fn("cli.auth.login")((input) =>
    login({
      target: Option.getOrUndefined(input.target),
      method: Option.getOrUndefined(input.method),
      answer: input.answer,
      server: Option.getOrUndefined(input.server),
      standalone: input.standalone,
    }).pipe(handlePromptErrors),
  ),
)

const login = Effect.fn("cli.auth.login.run")(function* (input: {
  target?: string
  method?: string
  answer?: ReadonlyArray<string>
  server?: string
  standalone: boolean
}) {
  if (!input.target)
    yield* requireInteractive("Pass an integration ID or name when running without an interactive terminal")
  intro("Connect an integration")
  const client = yield* createClient({ server: input.server, standalone: input.standalone })
  const integration = yield* findIntegration(client, input.target)
  const methods = connectMethods(integration)
  if (methods.length === 0) yield* Effect.fail(new Error(`${integration.name} has no interactive login methods`))
  const method = yield* chooseMethod(methods, input.method)
  const answer = yield* answerForm(method.type === "command" ? undefined : method.form, input.answer)
  yield* authenticate(client, integration, method, answer)
  outro("Done")
})

const findIntegration = Effect.fn("cli.auth.login.integration")(function* (client: OpenCodeClient, target?: string) {
  if (target && URL.canParse(target)) {
    const protocol = new URL(target).protocol
    if (protocol === "http:" || protocol === "https:") {
      const progress = spinner()
      progress.start("Discovering authentication provider...")
      yield* request((signal) => client.integration.wellknown.add({ url: target, location }, { signal })).pipe(
        Effect.tap(() => Effect.sync(() => progress.stop("Authentication provider discovered"))),
        Effect.tapCause(() => Effect.sync(() => progress.stop("Discovery failed", 1))),
      )
    }
  }
  const integrations = yield* loadIntegrations(client)
  if (target) return yield* resolveIntegration(integrations, target)
  const choices = loginChoices(integrations)
  if (choices.length === 0) return yield* Effect.fail(new Error("No authentication integrations are available"))
  const id = yield* prompt<string>(() => selectIntegration(choices))
  return yield* resolveIntegration(integrations, id)
})

export function loginChoices(integrations: IntegrationInfo[]): LoginChoice[] {
  return integrations
    .filter((integration) => connectMethods(integration).length > 0)
    .toSorted(
      (a, b) =>
        Number(b.metadata?.source === "mcp") - Number(a.metadata?.source === "mcp") ||
        (integrationPriority.get(a.id) ?? integrationPriority.size) -
          (integrationPriority.get(b.id) ?? integrationPriority.size) ||
        a.name.localeCompare(b.name) ||
        a.id.localeCompare(b.id),
    )
    .map((integration) => ({
      value: integration.id,
      label: integration.name,
      category:
        integration.metadata?.source === "mcp"
          ? "MCP"
          : integrationPriority.has(integration.id)
            ? "Popular"
            : "Services",
      connected: integration.connections.length > 0,
    }))
}

function selectIntegration(choices: LoginChoice[]) {
  return new AutocompletePrompt<LoginChoice>({
    options: choices,
    filter: (search, choice) =>
      [choice.label, choice.value, choice.category].some((value) => value.toLowerCase().includes(search.toLowerCase())),
    validate: (value) => (value ? undefined : "Select an integration"),
    render() {
      const title = `${color.gray(S_BAR)}\n${symbol(this.state)}  Select integration\n`
      if (this.state === "submit") {
        const choice = choices.find((item) => item.value === this.value)
        return `${title}${color.gray(S_BAR)}  ${color.dim(choice?.label ?? "")}`
      }
      if (this.state === "cancel")
        return `${title}${color.gray(S_BAR)}  ${color.strikethrough(color.dim(this.userInput))}`

      // Leave room for the category headings as well as Clack's title and footer.
      const maxItems = Math.min(8, Math.max(2, (process.stdout.rows ?? 24) - 14 - Number(this.state === "error")))
      const compact = (process.stdout.rows ?? 24) < 18
      const start = Math.min(Math.max(0, this.cursor - 2), Math.max(0, this.filteredOptions.length - maxItems))
      const visible = this.filteredOptions.slice(start, start + maxItems)
      const rows = visible.flatMap((choice, index) => [
        ...(index === 0 || visible[index - 1].category !== choice.category
          ? [...(compact ? [] : [`${color.cyan(S_BAR)}  `]), `${color.cyan(S_BAR)}  ${color.bold(choice.category)}`]
          : []),
        `${color.cyan(S_BAR)}  ${start + index === this.cursor ? color.green(S_RADIO_ACTIVE) : color.dim(S_RADIO_INACTIVE)} ${
          start + index === this.cursor ? choice.label : color.dim(choice.label)
        }${choice.connected ? ` ${color.green("✓")}` : ""}`,
      ])
      return [
        title,
        `${color.cyan(S_BAR)}  ${color.dim("Search:")} ${this.isNavigating ? color.dim(this.userInput) : this.userInputWithCursor}`,
        ...(visible.length === 0 && this.userInput
          ? [`${color.cyan(S_BAR)}  ${color.yellow("No integrations found")}`]
          : []),
        ...(this.state === "error" && visible.length > 0
          ? [`${color.yellow(S_BAR)}  ${color.yellow(this.error)}`]
          : []),
        ...(start > 0 ? [`${color.cyan(S_BAR)}  ${color.dim("…")}`] : []),
        ...rows,
        ...(start + maxItems < this.filteredOptions.length ? [`${color.cyan(S_BAR)}  ${color.dim("…")}`] : []),
        `${color.cyan(S_BAR)}  ${color.dim(
          (process.stdout.columns ?? 80) < 50
            ? "↑/↓ navigate • Enter select"
            : "↑/↓ to select • Enter: confirm • Type: to search",
        )}`,
        color.cyan(S_BAR_END),
      ].join("\n")
    },
  }).prompt()
}

const chooseMethod = Effect.fn("cli.auth.login.method")(function* (methods: ConnectMethod[], target?: string) {
  if (target) return yield* resolveMethod(methods, target)
  if (methods.length === 1) return methods[0]
  yield* requireInteractive("Pass --method when running without an interactive terminal")
  const id = yield* prompt<string>(() =>
    select({
      message: "Select login method",
      options: methods.map((method) => {
        if (method.type === "key") return { value: "key", label: method.label ?? "API key" }
        return { value: method.id, label: method.label }
      }),
    }),
  )
  return yield* resolveMethod(methods, id)
})

const authenticate = Effect.fn("cli.auth.login.authenticate")(function* (
  client: OpenCodeClient,
  integration: IntegrationInfo,
  method: ConnectMethod,
  answer?: FormAnswer,
) {
  if (method.type === "key") return yield* keyLogin(client, integration, method, answer)
  if (method.type === "command") return yield* commandLogin(client, integration, method)
  return yield* oauthLogin(client, integration, method, answer)
})

const keyLogin = Effect.fn("cli.auth.login.key")(function* (
  client: OpenCodeClient,
  integration: IntegrationInfo,
  method: Extract<ConnectMethod, { type: "key" }>,
  answer?: FormAnswer,
) {
  const key = yield* secret(method.label ?? `Enter your ${integration.name} API key`)
  const progress = spinner()
  progress.start("Saving credential...")
  yield* request((signal) =>
    client.integration.connect.key({ integrationID: integration.id, key, answer, location }, { signal }),
  ).pipe(
    Effect.tap(() => Effect.sync(() => progress.stop(`Connected to ${integration.name}`))),
    Effect.tapCause(() => Effect.sync(() => progress.stop("Authentication failed", 1))),
  )
})

const oauthLogin = Effect.fn("cli.auth.login.oauth")(function* (
  client: OpenCodeClient,
  integration: IntegrationInfo,
  method: Extract<ConnectMethod, { type: "oauth" }>,
  answer?: FormAnswer,
) {
  const progress = spinner()
  progress.start("Starting authorization...")
  const started = yield* request((signal) =>
    client.integration.oauth.connect(
      { integrationID: integration.id, methodID: method.id, answer, location },
      { signal },
    ),
  ).pipe(Effect.tapCause(() => Effect.sync(() => progress.stop("Authentication failed", 1))))
  const attempt = started.data
  yield* Effect.addFinalizer(() =>
    request(() =>
      client.integration.oauth.cancel(
        { integrationID: integration.id, attemptID: attempt.attemptID, location },
        { signal: AbortSignal.timeout(5_000) },
      ),
    ).pipe(Effect.ignore),
  )
  progress.stop("Authorization started")
  log.info(attempt.instructions)
  log.info(attempt.url)
  if (process.stdin.isTTY && process.stdout.isTTY) yield* openUrl(attempt.url)

  if (attempt.mode === "code") {
    yield* requireInteractive("This login requires an interactive terminal to enter the authorization code")
    const code = yield* prompt<string>(() =>
      text({ message: "Paste the authorization code", validate: (value) => (!value ? "Required" : undefined) }),
    )
    const completing = spinner()
    completing.start("Completing authorization...")
    yield* request((signal) =>
      client.integration.oauth.complete(
        { integrationID: integration.id, attemptID: attempt.attemptID, code, location },
        { signal },
      ),
    ).pipe(
      Effect.tap(() => Effect.sync(() => completing.stop(`Connected to ${integration.name}`))),
      Effect.tapCause(() => Effect.sync(() => completing.stop("Authentication failed", 1))),
    )
    return
  }

  const waiting = spinner()
  waiting.start("Waiting for authorization...")
  const status = yield* waitForOAuth(client, integration.id, attempt.attemptID).pipe(
    Effect.tapCause(() => Effect.sync(() => waiting.stop("Authentication failed", 1))),
  )
  if (status.status === "complete") {
    waiting.stop(`Connected to ${integration.name}`)
    return
  }
  waiting.stop("Authentication failed", 1)
  if (status.status === "failed") yield* Effect.fail(new Error(status.message))
  yield* Effect.fail(new Error("Authorization expired"))
})

const commandLogin = Effect.fn("cli.auth.login.command")(function* (
  client: OpenCodeClient,
  integration: IntegrationInfo,
  method: Extract<ConnectMethod, { type: "command" }>,
) {
  const progress = spinner()
  progress.start("Starting authentication command...")
  const started = yield* request((signal) =>
    client.integration.command.connect({ integrationID: integration.id, methodID: method.id, location }, { signal }),
  ).pipe(Effect.tapCause(() => Effect.sync(() => progress.stop("Authentication failed", 1))))
  yield* Effect.addFinalizer(() =>
    request(() =>
      client.integration.command.cancel(
        {
          integrationID: integration.id,
          attemptID: started.data.attemptID,
          location,
        },
        { signal: AbortSignal.timeout(5_000) },
      ),
    ).pipe(Effect.ignore),
  )
  const status = yield* waitForCommand(client, integration.id, started.data.attemptID, (message) =>
    progress.message(message.trim() || "Waiting for authentication command..."),
  ).pipe(Effect.tapCause(() => Effect.sync(() => progress.stop("Authentication failed", 1))))
  if (status.status === "complete") {
    progress.stop(`Connected to ${integration.name}`)
    return
  }
  progress.stop("Authentication failed", 1)
  if (status.status === "failed") yield* Effect.fail(new Error(status.message))
  yield* Effect.fail(new Error("Authentication expired"))
})

const waitForOAuth = Effect.fn("cli.auth.login.oauth.wait")(function* (
  client: OpenCodeClient,
  integrationID: string,
  attemptID: string,
) {
  while (true) {
    const response = yield* request((signal) =>
      client.integration.oauth.status({ integrationID, attemptID, location }, { signal }),
    )
    if (response.data.status !== "pending") return response.data
    yield* Effect.sleep(500)
  }
})

const waitForCommand = Effect.fn("cli.auth.login.command.wait")(function* (
  client: OpenCodeClient,
  integrationID: string,
  attemptID: string,
  update: (message: string) => void,
) {
  while (true) {
    const response = yield* request((signal) =>
      client.integration.command.status({ integrationID, attemptID, location }, { signal }),
    )
    if (response.data.status !== "pending") return response.data
    if (response.data.message) update(response.data.message)
    yield* Effect.sleep(500)
  }
})
