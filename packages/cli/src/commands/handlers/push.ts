import type { Argv } from "yargs"
import { Effect } from "effect"
import { UI } from "../ui"
import { effectCmd, fail } from "../effect-cmd"

// Session handoff, sending side: `bolt push <sessionID> <url>` exports the
// local session as a bundle and imports it into the bolt server running on
// another machine, so work started here can be resumed there.

/** Resolve a bolt server base URL to its handoff endpoint. */
export function endpoint(url: string) {
  const parsed = (() => {
    try {
      return new URL(url)
    } catch {
      return undefined
    }
  })()
  if (!parsed) return undefined
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined
  return new URL("/handoff/session", parsed.origin).toString()
}

export const PushCommand = effectCmd({
  command: "push <sessionID> <url>",
  describe: "push a session to a bolt server on another machine",
  builder: (yargs: Argv) =>
    yargs
      .positional("sessionID", {
        type: "string",
        demandOption: true,
        describe: "session id to push",
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
  handler: Effect.fn("Cli.push")(function* (args) {
    const target = endpoint(args.url)
    if (!target) return yield* fail(`Invalid server URL: ${args.url}. Expected http(s)://host:port`)
    const { SessionBundle } = yield* Effect.promise(() => import("@/session/bundle"))
    const { ServerAuth } = yield* Effect.promise(() => import("@/server/auth"))
    const data = yield* SessionBundle.dump(args.sessionID).pipe(
      Effect.catchCause(() => fail(`Session not found: ${args.sessionID}`)),
    )
    const headers: Record<string, string> = {
      "content-type": "application/json",
      ...ServerAuth.headers({ password: args.password, username: args.username }),
    }
    if (args.dir) headers["x-opencode-directory"] = args.dir
    const response = yield* Effect.tryPromise({
      try: () => fetch(target, { method: "POST", headers, body: JSON.stringify(data) }),
      catch: () => `Could not reach ${args.url}. Is bolt serve running on the remote machine?`,
    }).pipe(Effect.catch((message) => fail(message)))
    if (!response.ok) {
      const body = yield* Effect.promise(() => response.text().catch(() => ""))
      return yield* fail(`Push failed with status ${response.status}: ${body.slice(0, 200)}`.trim())
    }
    UI.println(`Pushed session ${args.sessionID} to ${args.url}`)
    UI.println(`Resume it on that machine with: bolt --session ${args.sessionID}`)
  }),
})
