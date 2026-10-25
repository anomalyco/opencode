import type { Argv } from "yargs"
import { Effect } from "effect"
import { UI } from "../ui"
import { effectCmd, fail } from "../effect-cmd"
import { endpoint } from "./push"

// Session handoff, receiving side: `bolt pull <sessionID> <url>` fetches a
// session bundle from a bolt server on another machine and imports it into
// the local project, ready to resume.

export const PullCommand = effectCmd({
  command: "pull <sessionID> <url>",
  describe: "pull a session from a bolt server on another machine",
  builder: (yargs: Argv) =>
    yargs
      .positional("sessionID", {
        type: "string",
        demandOption: true,
        describe: "session id to pull",
      })
      .positional("url", {
        type: "string",
        demandOption: true,
        describe: "remote bolt server url (start one there with: bolt serve)",
      })
      .option("password", {
        alias: ["p"],
        type: "string",
        describe: "basic auth password (defaults to BOLT_SERVER_PASSWORD)",
      })
      .option("username", {
        alias: ["u"],
        type: "string",
        describe: "basic auth username (defaults to BOLT_SERVER_USERNAME or 'bolt')",
      })
      .option("dir", {
        type: "string",
        describe: "project directory on the remote machine (defaults to the remote server's working directory)",
      }),
  handler: Effect.fn("Cli.pull")(function* (args) {
    const base = endpoint(args.url)
    if (!base) return yield* fail(`Invalid server URL: ${args.url}. Expected http(s)://host:port`)
    const { InstanceRef } = yield* Effect.promise(() => import("@/effect/instance-ref"))
    const { SessionBundle } = yield* Effect.promise(() => import("@/session/bundle"))
    const { ServerAuth } = yield* Effect.promise(() => import("@/server/auth"))
    const ctx = yield* InstanceRef
    if (!ctx) return yield* fail("Could not load instance context")
    const headers: Record<string, string> = {
      ...ServerAuth.headers({ password: args.password, username: args.username }),
    }
    if (args.dir) headers["x-opencode-directory"] = args.dir
    const target = `${base}?sessionID=${encodeURIComponent(args.sessionID)}`
    const response = yield* Effect.tryPromise({
      try: () => fetch(target, { headers }),
      catch: () => `Could not reach ${args.url}. Is bolt serve running on the remote machine?`,
    }).pipe(Effect.catch((message) => fail(message)))
    if (response.status === 404) return yield* fail(`Session not found on ${args.url}: ${args.sessionID}`)
    if (!response.ok) {
      const body = yield* Effect.promise(() => response.text().catch(() => ""))
      return yield* fail(`Pull failed with status ${response.status}: ${body.slice(0, 200)}`.trim())
    }
    const data = yield* Effect.tryPromise({
      try: () => response.json(),
      catch: () => "Remote server returned invalid JSON",
    }).pipe(Effect.catch((message) => fail(message)))
    if (!SessionBundle.valid(data)) return yield* fail("Remote server did not return a session bundle")
    yield* SessionBundle.load(data, ctx).pipe(Effect.catchCause(() => fail("Session bundle could not be imported")))
    UI.println(`Pulled session ${args.sessionID} from ${args.url}`)
    UI.println(`Resume it with: bolt --session ${args.sessionID}`)
  }),
})
