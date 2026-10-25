import { Effect } from "effect"
import { UI } from "../ui"
import { effectCmd, fail } from "../effect-cmd"
import { Flag } from "@bolt-ai/core/flag/flag"

/** Build the copy-pasteable command a partner runs to join a pair session. */
export function invite(input: { url: string; session: string; password?: boolean }) {
  const parts = ["bolt", "pair", "--join", input.url, "--session", input.session]
  if (input.password) parts.push("--password", "<password>")
  return parts.join(" ")
}

export const PairCommand = effectCmd({
  command: "pair",
  describe: "share a live session between two terminals",
  // The host serves instances per-request via the directory header and the
  // joiner talks to a remote server, so no ambient instance is needed.
  instance: false,
  builder: (yargs) =>
    yargs
      .option("join", {
        type: "string",
        describe: "join a pair session on a running bolt server (e.g., http://localhost:4096)",
      })
      .option("session", {
        alias: ["s"],
        type: "string",
        describe: "session id to join (defaults to the most recent session on the server)",
      })
      .option("port", {
        type: "number",
        default: 0,
        describe: "port for the local server (defaults to a random port)",
      })
      .option("hostname", {
        type: "string",
        default: "127.0.0.1",
        describe: "hostname for the local server",
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
      }),
  handler: Effect.fn("Cli.pair")(function* (args) {
    if (!process.stdout.isTTY) return yield* fail("bolt pair requires an interactive terminal")

    const { ServerAuth } = yield* Effect.promise(() => import("@/server/auth"))
    const { createBoltClient } = yield* Effect.promise(() => import("@bolt-ai/sdk/v2"))
    const { runMini } = yield* Effect.promise(() => import("./run"))
    const headers = ServerAuth.headers({ password: args.password, username: args.username })

    if (args.join) {
      const url = args.join
      const session = yield* Effect.gen(function* () {
        if (args.session) return args.session
        const sdk = createBoltClient({ baseUrl: url, headers })
        const list = yield* Effect.promise(() =>
          sdk.session.list().then(
            (value) => value.data,
            () => undefined,
          ),
        )
        if (!list) {
          return yield* fail(`Could not list sessions on ${url}. Check the URL and the server password.`)
        }
        const recent = list.find((item) => !item.parentID)
        if (!recent) {
          return yield* fail(`No session found on ${url}. Ask the host to start one with: bolt pair`)
        }
        return recent.id
      })

      UI.println(`Joining session ${session} on ${url}`)
      yield* Effect.promise(() =>
        runMini({
          attach: url,
          session,
          password: args.password,
          username: args.username,
          pair: true,
        }),
      )
      return
    }

    // Host flow: boot the local server, create the shared session, print the
    // join command, and enter interactive mode attached over HTTP so both
    // terminals drive the session through the exact same machinery.
    const secured = Boolean(Flag.BOLT_SERVER_PASSWORD)
    // "localhost" resolves through DNS/hosts and may map to a non-loopback
    // address, so pin unauthenticated binds to a literal loopback IP.
    const hostname = !secured && args.hostname === "localhost" ? "127.0.0.1" : args.hostname
    // Refuse to expose an unauthenticated server beyond loopback: the API
    // grants file read/write and shell execution (mirrors `bolt serve`).
    if (!secured && !["127.0.0.1", "::1"].includes(hostname)) {
      return yield* fail(
        "Refusing to listen on a non-loopback interface without authentication. Set BOLT_SERVER_PASSWORD or bind to 127.0.0.1.",
      )
    }

    const { Server } = yield* Effect.promise(() => import("../../server/server"))
    const server = yield* Effect.promise(() => Server.listen({ hostname, port: args.port, cors: [] }))
    const url = server.url.origin

    const sdk = createBoltClient({ baseUrl: url, directory: process.cwd(), headers })
    const created = yield* Effect.promise(() =>
      sdk.session.create({ title: "bolt pair" }).then(
        (value) => value.data,
        () => undefined,
      ),
    )
    if (!created?.id) {
      yield* Effect.promise(() => server.stop(true))
      return yield* fail("Could not create the pair session.")
    }

    UI.println(`Pair session ${created.id} on ${url}`)
    UI.empty()
    UI.println("To pair from another terminal, run:")
    UI.println(`  ${invite({ url, session: created.id, password: secured })}`)
    if (secured) UI.println("  (replace <password> with the value of BOLT_SERVER_PASSWORD on this machine)")
    UI.empty()

    yield* Effect.promise(() =>
      runMini({
        attach: url,
        session: created.id,
        password: args.password,
        username: args.username,
        pair: true,
      }),
    ).pipe(Effect.ensuring(Effect.promise(() => server.stop(true))))
  }),
})
