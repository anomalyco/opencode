#!/usr/bin/env node
import { spawn } from "node:child_process"
import { parseArgs } from "node:util"
import type { Effect } from "effect"
import type { HttpClient } from "effect/http"
import { version } from "../package.json" with { type: "json" }

// Harness hooks run `check` before every tool call, so each command imports only what it needs.
const parsed = parseArgs({
  allowPositionals: true,
  strict: false,
  options: {
    harness: { type: "string" },
    server: { type: "string" },
    json: { type: "boolean" },
    quiet: { type: "boolean" },
  },
})
const command = parsed.positionals[0]
const flags = parsed.values
const harness = flag("harness") ?? process.env.OPENCODE_CONNECT_HARNESS
const NOT_SIGNED_IN = "Not signed in. Run `opencode-connect login` or set OPENCODE_API_KEY."

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
  // A hook that can't decide must block: harnesses treat other failures as allow.
  return command === "check" ? 2 : 1
})

/**
 * Reads `{ action, resources, directory?, shell? }` from stdin and answers with the workspace policy's decision:
 * `{"effect":"allow"}` and exit code 0, or `{"effect":"deny","message":...}` and exit code 2.
 *
 * It decides from the stored workspace config and never calls the Console itself. A config older than a minute is
 * refreshed by a background `sync` for the next call; a sign-in with no config yet starts one and waits up to 3 seconds
 * for it. A signed-in workspace whose policy is still unknown after that is denied, so a Console outage never lifts
 * policy, and a refresh still in flight is never cut short.
 */
async function check() {
  const { Effect, Option, Schema } = await import("effect")
  const { ConsoleAccess } = await import("@opencode/core/console-access")
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
  const owner = credential && ConsoleCredentials.owner(credential)
  const snapshot =
    owner && cached?.owner !== owner
      ? await (async () => {
          await background({ always: true })
          return waitFor(() => {
            const next = WorkspaceSnapshot.read(store)
            return next?.owner === owner ? next : undefined
          }, 3_000)
        })()
      : cached && WorkspaceSnapshot.stale(cached, Date.now())
        ? (await background(), cached)
        : cached
  const decision = await Effect.runPromise(
    PolicyEvaluator.check(
      credential
        ? {
            organization: snapshot?.organization ?? ConsoleAccess.organizationName(credential),
            policies: WorkspaceSnapshot.policies(snapshot),
            status: snapshot?.status,
          }
        : { policies: [] },
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
          process.stderr.write(`Open ${device.url} and confirm the code ${device.code}\n`)
          if (!process.stdout.isTTY) return
          const { openUrl } = await import("@opencode/util/open")
          await openUrl(device.url).catch(() => undefined)
        }),
    }),
  )
  const result = await withConsole((http) => WorkspaceSync.sync(store, http, { force: true }))
  const email = credential.metadata?.email
  process.stdout.write(
    `Signed in to ${ConsoleAccess.organizationName(credential) ?? "OpenCode Console"}${typeof email === "string" ? ` as ${email}` : ""}\n`,
  )
  if (result.error)
    process.stderr.write(
      `Couldn't fetch the workspace config: ${message(result.error)}. Run \`opencode-connect sync\` to try again.\n`,
    )
  return 0
}

async function logout() {
  const { ConnectStore } = await import("@opencode/client-core/store")
  const { ConsoleCredentials } = await import("@opencode/client-core/credentials")
  const signedOut = await withConsole((http) => ConsoleCredentials.logout(ConnectStore.make(), http))
  process.stdout.write(signedOut ? "Signed out of OpenCode Console\n" : "Not signed in\n")
  if (process.env.OPENCODE_API_KEY)
    process.stdout.write("OPENCODE_API_KEY is still set, so opencode-connect keeps using that key\n")
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
  const policies = WorkspaceSnapshot.policies(snapshot)
  const info = credential && {
    server: ConsoleAccess.server(credential),
    credential: credential.type === "key" ? ("OPENCODE_API_KEY" as const) : ("device" as const),
    email: typeof credential.metadata?.email === "string" ? credential.metadata.email : undefined,
    workspace: snapshot?.organization ?? ConsoleAccess.organizationName(credential),
    synced: policies && snapshot ? new Date(snapshot.fetched).toISOString() : undefined,
    policies: policies?.length,
    models: WorkspaceSnapshot.models(snapshot),
    routing: WorkspaceSnapshot.routing(snapshot),
    needs: snapshot?.status,
  }
  if (flags.json === true) {
    process.stdout.write(`${JSON.stringify({ signedIn: Boolean(info), ...info })}\n`)
    return 0
  }
  if (!info) {
    process.stdout.write(`${NOT_SIGNED_IN}\n`)
    return 0
  }
  const lines = [
    ["Signed in", info.credential === "OPENCODE_API_KEY" ? "with OPENCODE_API_KEY" : (info.email ?? "yes")],
    ["Workspace", info.workspace ?? "none"],
    ["Console", info.server],
    [
      "Policies",
      info.synced
        ? `${count(info.policies ?? 0, "policy", "policies")}, synced at ${new Date(info.synced).toLocaleTimeString()}`
        : "not loaded yet, so tool calls are blocked",
    ],
    ["Models", info.models ? `${info.models} available from the workspace` : "none from the workspace"],
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
    process.stderr.write(`${NOT_SIGNED_IN}\n`)
    return 1
  }
  if (result.error) {
    const kept = WorkspaceSnapshot.policies(result.snapshot) ? "\nPolicies from the last sync still apply." : ""
    process.stderr.write(`Couldn't sync: ${message(result.error)}${kept}\n`)
    return 1
  }
  const organization = result.snapshot?.organization
  const policies = WorkspaceSnapshot.policies(result.snapshot)?.length ?? 0
  process.stdout.write(
    `Synced ${organization ? `${organization}'s` : "the workspace"} config (${count(policies, "policy", "policies")})\n`,
  )
  return 0
}

/** Prints an access token valid for at least a minute, for harness auth helpers such as Claude Code's `apiKeyHelper`. */
async function token() {
  const { ConnectStore } = await import("@opencode/client-core/store")
  const { ConsoleCredentials } = await import("@opencode/client-core/credentials")
  const credential = await withConsole((http) => ConsoleCredentials.fresh(ConnectStore.make(), http))
  if (!credential) {
    process.stderr.write(`${NOT_SIGNED_IN}\n`)
    return 1
  }
  process.stdout.write(`${credential.type === "key" ? credential.key : credential.access}\n`)
  return 0
}

async function refresh() {
  const { Effect } = await import("effect")
  const { ConnectStore } = await import("@opencode/client-core/store")
  const { WorkspaceSync } = await import("@opencode/client-core/workspace-sync")
  return withConsole((http) =>
    WorkspaceSync.sync(ConnectStore.make(), http).pipe(Effect.map((result) => result.snapshot)),
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

// Detached, so a harness never waits on the Console and a refresh outlives the check that started it; the next check
// reads what it stored. At most one starts every 30 seconds, so a Console outage doesn't start a process on every tool
// call. A store or process failure here never stops the check from deciding.
async function background(options: { readonly always?: boolean } = {}) {
  const { ConnectStore } = await import("@opencode/client-core/store")
  const claim = ConnectStore.syncClaimFile(ConnectStore.make())
  const claimed = ConnectStore.modified(claim)
  if (!options.always && claimed !== undefined && Date.now() - claimed < 30_000) return
  try {
    ConnectStore.write(claim, "")
    const self = compiled() ? [process.execPath] : [process.execPath, process.argv[1]]
    spawn(self[0], [...self.slice(1), "sync", "--quiet", ...(harness ? ["--harness", harness] : [])], {
      detached: true,
      stdio: "ignore",
    })
      .on("error", () => undefined)
      .unref()
  } catch {
    return
  }
}

async function waitFor<A>(read: () => A | undefined, timeout: number) {
  const deadline = Date.now() + timeout
  for (;;) {
    const value = read()
    if (value !== undefined || Date.now() >= deadline) return value
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

function count(value: number, one: string, many: string) {
  return `${value} ${value === 1 ? one : many}`
}

function compiled() {
  return /^(\/\$bunfs\/|[A-Za-z]:[\\/]~BUN[\\/])/.test(process.argv[1] ?? "")
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

function usage() {
  return `opencode-connect ${version}
Sign coding agents in to an OpenCode Console workspace and check their tool calls against its policies.

Usage: opencode-connect <command> [options]

Commands:
  login [--server <url>]  Sign in to OpenCode Console and pick a workspace
  logout                  Sign out and remove the stored workspace config
  status [--json]         Show the sign-in, workspace and config
  token                   Print an access token for auth helpers such as Claude Code's apiKeyHelper
  sync                    Fetch the workspace config now
  check                   Check a tool call against the workspace's policies. Reads
                          {"action": "...", "resources": [...]} on stdin, with optional
                          "directory" and "shell"; exits 0 to allow, 2 to deny

Options:
  --harness <name/version>  Identify the calling agent to the Console, e.g. claude-cli/2.1.304
                            (or set OPENCODE_CONNECT_HARNESS)

Set OPENCODE_API_KEY to use a personal or service account key instead of signing in.
Set OPENCODE_CONNECT_SERVER with it to use a Console other than https://opencode.ai/console.
`
}
