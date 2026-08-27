import type { Argv } from "yargs"
import { Effect } from "effect"
import { ServerAuth } from "@/server/auth"
import { SessionID } from "@/session/schema"
import { TelegramBridge } from "@/telegram/bridge"
import { effectCmd, fail } from "../effect-cmd"

export const TelegramCommand = effectCmd({
  command: "telegram",
  describe: "link a Telegram chat to an opencode session",
  instance: true,
  builder: (yargs: Argv) => {
    return yargs.option("session", {
      type: "string",
      alias: ["s"],
      describe: "session id to link with Telegram",
    })
  },
  handler: Effect.fn("Cli.telegram")(function* (args: { session?: string }) {
    const bridge = yield* TelegramBridge.Service
    const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const { Server } = await import("@/server/server")
      const request = new Request(input, init)
      const headers = new Headers(request.headers)
      const auth = ServerAuth.header()
      if (auth) headers.set("Authorization", auth)
      return Server.Default().app.fetch(new Request(request, { headers }))
    }) as typeof globalThis.fetch

    bridge.configure({ baseUrl: "http://opencode.internal", fetch: fetchFn })
    const sessionID = args.session ? SessionID.make(args.session) : undefined
    const link = yield* bridge.link({ sessionID }).pipe(
      Effect.catch((error) => fail(error.message)),
    )
    console.log(`Open this link in Telegram to connect a chat (valid for 10 minutes):\n${link.url}`)
    console.log("Telegram bridge running. Press Ctrl+C to stop.")
    yield* Effect.never
  }),
})
