#!/usr/bin/env node
import { spawn } from "node:child_process"
import type { Effect } from "effect"
import type { HttpClient } from "effect/http"
import { version } from "../package.json" with { type: "json" }

// Harness hooks run `check` before every tool call, so each command imports only what it needs.
const args = process.argv.slice(2)
const command = args[0]
const flags = parseFlags(args.slice(1))
const harness = flag("harness") ?? process.env.OPENCODE_CONNECT_HARNESS

const commands: Record<string, () => Promise<number>> = {
  check,
  login,
  logout,
  status,
  sync,
  token,
}

const run = command ? commands[command] : undefined
if (!run) {
  process.stdout.write(usage())
  process.exit(command && !["help", "--help", "-h"].includes(command) ? 1 : 0)
}
process.exitCode = await run().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  return 1
})

/**
 * Reads `{ action, resources, directory?, shell? }` from stdin and answers with the workspace policy's decision:
 * `{"effect":"allow"}` and exit code 0, or `{"effect":"deny","message":...}` and exit code 2.
 *
 * It decides from the stored workspace config without waiting on the network. A config older than a minute is
 * refreshed in the background for the next call; only a sign-in with no config yet waits, for up to 3 seconds.
 */
async function check() {
  const { Effect, Option, Schema } = await import("effect")
  const { ConnectStore } = await import("@opencode/client-core/store")
  const { ConsoleCredentials } = await import("@opencode/client-core/credentials")
  const { WorkspaceSnapshot } = await import("@opencode/client-core/snapshot")
  const { PolicyEvaluator } = await import("@opencode/client-core/policy-evaluator")
  const input = Schema.decodeUnknownOption(
    Schema.fromJsonString(
      Schema.Struct({
        action: Schema.String,
        resources: Schema.Array(Schema.String),
        directory: Schema.optional(Schema.String),
        shell: Schema.optional(Schema.String),
      }),
    ),
  )(await stdin())
  if (Option.isNone(input)) {
    process.stderr.write('Expected JSON on stdin: {"action": "...", "resources": ["..."]}\n')
    return 1
  }
  const store = ConnectStore.make()
  const credential = ConsoleCredentials.read(store)
  const cached = credential ? WorkspaceSnapshot.read(store) : undefined
  const snapshot =
    credential && cached?.owner !== ConsoleCredentials.owner(credential)
      ? await refresh({ wait: 3_000 })
      : cached && WorkspaceSnapshot.stale(cached, Date.now())
        ? (background(), cached)
        : cached
  const decision = await Effect.runPromise(
    PolicyEvaluator.check(
      { organization: snapshot?.organization, policies: WorkspaceSnapshot.policies(snapshot) },
      input.value,
    ),
  )
  process.stdout.write(`${JSON.stringify(decision)}\n`)
  return decision.effect === "deny" ? 2 : 0
}

async function login() {
  const { Effect } = await import("effect")
  const { ConsoleAccess } = await import("@opencode/core/console-access")
  const { ConnectStore } = await import("@opencode/client-core/store")
  const { ConsoleCredentials } = await import("@opencode/client-core/credentials")
  const { WorkspaceSync } = await import("@opencode/client-core/workspace-sync")
  const store = ConnectStore.make()
  const credential = await withConsole((http) =>
    ConsoleCredentials.login(store, http, {
      server: flag("server") ?? ConsoleAccess.defaultServer,
      prompt: (device) =>
        Effect.promise(async () => {
          process.stderr.write(`Open ${device.url}\nand confirm the code ${device.code}\n`)
          if (!process.stdout.isTTY) return
          const { openUrl } = await import("@opencode/util/open")
          await openUrl(device.url).catch(() => undefined)
        }),
    }),
  )
  const result = await withConsole((http) => WorkspaceSync.sync(store, http, { force: true }))
  process.stdout.write(
    `Signed in to ${ConsoleAccess.organizationName(credential) ?? "OpenCode Console"} as ${credential.metadata?.email}\n`,
  )
  if (result.error) process.stderr.write(`Couldn't load the workspace config yet: ${message(result.error)}\n`)
  return 0
}

async function logout() {
  const { ConnectStore } = await import("@opencode/client-core/store")
  const { ConsoleCredentials } = await import("@opencode/client-core/credentials")
  const signedOut = await withConsole((http) => ConsoleCredentials.logout(ConnectStore.make(), http))
  process.stdout.write(signedOut ? "Signed out of OpenCode Console\n" : "Not signed in\n")
  if (process.env.OPENCODE_API_KEY) process.stdout.write("OPENCODE_API_KEY is still set and stays in use\n")
  return 0
}

async function status() {
  const { ConsoleAccess } = await import("@opencode/core/console-access")
  const { ConnectStore } = await import("@opencode/client-core/store")
  const { ConsoleCredentials } = await import("@opencode/client-core/credentials")
  const { WorkspaceSnapshot } = await import("@opencode/client-core/snapshot")
  const store = ConnectStore.make()
  const credential = ConsoleCredentials.read(store)
  const snapshot = credential ? await refresh() : undefined
  const telemetry = WorkspaceSnapshot.telemetry(snapshot)
  const info = credential && {
    server: ConsoleAccess.server(credential),
    credential: credential.type === "key" ? "OPENCODE_API_KEY" : "device sign-in",
    email: credential.metadata?.email,
    workspace: snapshot?.organization ?? ConsoleAccess.organizationName(credential),
    synced: snapshot?.config ? new Date(snapshot.fetched).toISOString() : undefined,
    policies: WorkspaceSnapshot.policies(snapshot).length,
    models: WorkspaceSnapshot.models(snapshot),
    routing: WorkspaceSnapshot.routing(snapshot),
    needs: snapshot?.status,
    telemetry: telemetry !== undefined,
  }
  if (flags.json === true) {
    process.stdout.write(`${JSON.stringify({ signedIn: Boolean(info), ...info })}\n`)
    return 0
  }
  if (!info) {
    process.stdout.write("Not signed in. Run `opencode-connect login` to connect OpenCode Console.\n")
    return 0
  }
  const lines = [
    ["Signed in", `${info.email ?? "API key"} (${info.credential})`],
    ["Workspace", info.workspace ?? "none"],
    ["Console", info.server],
    ["Config", info.synced ? `${info.policies} policies, synced ${info.synced}` : "not synced"],
    [
      "Models",
      info.routing === "gateway"
        ? `${info.models} through the workspace gateway`
        : "none from the workspace; harnesses keep their own provider",
    ],
    ...(telemetry
      ? [["Usage", `token counts and model names are shared with ${info.workspace ?? "the workspace"}`]]
      : []),
  ]
  process.stdout.write(lines.map(([label, value]) => `${label.padEnd(10)} ${value}\n`).join(""))
  if (info.needs) process.stdout.write(`\n${info.needs.message}${info.needs.url ? `: ${info.needs.url}` : ""}\n`)
  return 0
}

/** Fetches the workspace config now. `--quiet` is how `check` runs it in the background. */
async function sync() {
  const { ConnectStore } = await import("@opencode/client-core/store")
  const { WorkspaceSnapshot } = await import("@opencode/client-core/snapshot")
  const { WorkspaceSync } = await import("@opencode/client-core/workspace-sync")
  const result = await withConsole((http) =>
    WorkspaceSync.sync(ConnectStore.make(), http, { force: flags.quiet !== true }),
  )
  if (flags.quiet === true) return result.error ? 1 : 0
  if (!result.snapshot && !result.error) {
    process.stderr.write("Not signed in. Run `opencode-connect login` first.\n")
    return 1
  }
  if (result.error) {
    process.stderr.write(
      `Couldn't sync: ${message(result.error)}${result.snapshot ? "\nThe last synced config stays in force." : ""}\n`,
    )
    return 1
  }
  const policies = WorkspaceSnapshot.policies(result.snapshot).length
  process.stdout.write(`Synced ${result.snapshot?.organization ?? "workspace"} config: ${policies} policies\n`)
  return 0
}

/** Prints an access token valid for at least a minute, for harness auth helpers such as Claude Code's `apiKeyHelper`. */
async function token() {
  const { ConnectStore } = await import("@opencode/client-core/store")
  const { ConsoleCredentials } = await import("@opencode/client-core/credentials")
  const credential = await withConsole((http) => ConsoleCredentials.fresh(ConnectStore.make(), http))
  if (!credential) {
    process.stderr.write("Not signed in. Run `opencode-connect login` or set OPENCODE_API_KEY.\n")
    return 1
  }
  process.stdout.write(`${credential.type === "key" ? credential.key : credential.access}\n`)
  return 0
}

async function refresh(options: { readonly wait?: number } = {}) {
  const { Effect } = await import("effect")
  const { ConnectStore } = await import("@opencode/client-core/store")
  const { WorkspaceSync } = await import("@opencode/client-core/workspace-sync")
  return withConsole((http) =>
    WorkspaceSync.sync(ConnectStore.make(), http).pipe(
      Effect.map((result) => result.snapshot),
      options.wait === undefined
        ? (effect) => effect
        : Effect.timeoutOrElse({ duration: options.wait, orElse: () => Effect.succeed(undefined) }),
    ),
  )
}

/** Runs a Console request with the connector's identity on every call. */
async function withConsole<A, E>(body: (http: HttpClient.HttpClient) => Effect.Effect<A, E>) {
  const { Effect } = await import("effect")
  const { FetchHttpClient, HttpClient } = await import("effect/http")
  const { WorkspaceSync } = await import("@opencode/client-core/workspace-sync")
  return Effect.runPromise(
    Effect.gen(function* () {
      const http = yield* HttpClient.HttpClient
      return yield* body(WorkspaceSync.identify(http, { version, harness }))
    }).pipe(Effect.provide(FetchHttpClient.layer)),
  )
}

// Detached, so a harness never waits on the Console; the next check reads what it stored.
function background() {
  const self = compiled() ? [process.execPath] : [process.execPath, process.argv[1]]
  spawn(self[0], [...self.slice(1), "sync", "--quiet", ...(harness ? ["--harness", harness] : [])], {
    detached: true,
    stdio: "ignore",
  }).unref()
}

function compiled() {
  return /^(\/\$bunfs\/|[A-Z]:\\~BUN\\)/.test(process.argv[1] ?? "")
}

async function stdin() {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString("utf8")
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function flag(name: string) {
  const value = flags[name]
  return typeof value === "string" ? value : undefined
}

function parseFlags(input: string[]) {
  return input.reduce<{ flags: Record<string, string | true>; pending?: string }>(
    (state, item) => {
      if (item.startsWith("--")) {
        const [name, value] = item.slice(2).split("=", 2)
        if (value !== undefined) return { flags: { ...state.flags, [name]: value } }
        return { flags: { ...state.flags, [name]: true }, pending: name }
      }
      if (state.pending) return { flags: { ...state.flags, [state.pending]: item } }
      return state
    },
    { flags: {} },
  ).flags
}

function usage() {
  return `opencode-connect ${version}: use an OpenCode Console workspace from other coding agents

Usage: opencode-connect <command> [options]

Commands:
  login [--server <url>]  Sign in to OpenCode Console and pick a workspace
  logout                  Sign out and remove the stored workspace config
  status [--json]         Show the sign-in, workspace and config
  token                   Print an access token for a harness's auth helper
  sync                    Fetch the workspace config now
  check                   Decide a tool call against workspace policy
                          (reads {"action","resources","directory"?,"shell"?} JSON on stdin)

Options:
  --harness <name/version>  Name the harness in requests to the Console
                            (also OPENCODE_CONNECT_HARNESS)

Set OPENCODE_API_KEY to use a personal or service account key instead of signing in.
`
}
