import { expect } from "bun:test"
import { Effect } from "effect"
import { HttpServer } from "effect/unstable/http"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { OpenCode } from "../../client/src/promise/index"
import { it } from "../../core/test/lib/effect"
import { ServerProcess } from "../src/process"

const live = process.platform === "win32" ? it.live.skip : it.live

live(
  "PTY websocket preserves replay, text and binary input, resize, reconnect, and exit",
  () =>
    Effect.gen(function* () {
      const directory = yield* Effect.acquireRelease(
        Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), "opencode-pty-transport-"))),
        (directory) => Effect.promise(() => fs.rm(directory, { recursive: true, force: true })),
      )
      const server = yield* ServerProcess.start<never, never>({
        hostname: "127.0.0.1",
        port: 0,
        password: "secret",
        app: { version: "test-version" },
        database: { path: ":memory:" },
        models: { fetch: false },
        config: { directory, project: false, content: "{}" },
        fs: { filewatcher: false },
      })
      const base = HttpServer.formatAddress(server.address)
      const client = OpenCode.make({ baseUrl: base, headers: { authorization: `Basic ${btoa("opencode:secret")}` } })
      const location = { directory }
      const terminal = yield* Effect.acquireRelease(
        Effect.promise(() =>
          client.pty.create({
            location,
            command: "/bin/sh",
            args: [
              "-c",
              "stty -echo; printf 'ready\\n'; while IFS= read -r line; do case \"$line\" in size) stty size;; quit) exit 0;; *) printf 'reply:%s\\n' \"$line\";; esac; done",
            ],
            cwd: directory,
          }),
        ),
        (terminal) => Effect.promise(() => client.pty.remove({ location, ptyID: terminal.data.id })),
      )
      yield* Effect.promise(async () => {
        const connect = async () => {
          const token = await client.pty.connect.token({ location, ptyID: terminal.data.id, "x-opencode-ticket": "1" })
          const url = new URL(`/api/pty/${terminal.data.id}/connect`, base)
          url.protocol = "ws:"
          url.searchParams.set("location[directory]", directory)
          url.searchParams.set("ticket", token.data.ticket)
          const socket = new WebSocket(url)
          socket.binaryType = "arraybuffer"
          const state = { output: "", frames: [] as string[], closed: false, code: 0, error: false }
          socket.addEventListener("message", (event) => {
            if (typeof event.data === "string") {
              state.output += event.data
              state.frames.push("output")
              return
            }
            const bytes = new Uint8Array(event.data)
            if (bytes[0] === 0) {
              state.frames.push("cursor")
              return
            }
            state.output += new TextDecoder().decode(bytes)
            state.frames.push("output")
          })
          socket.addEventListener("close", (event) => {
            state.closed = true
            state.code = event.code
          })
          socket.addEventListener("error", () => {
            state.error = true
          })
          await waitFor(() => state.frames.includes("cursor") || state.closed || state.error)
          expect(state.error).toBeFalse()
          expect(state.closed).toBeFalse()
          return { socket, state }
        }
        const first = await connect()
        try {
          await waitFor(() => first.state.output.includes("ready"))
          first.socket.send("text\n")
          first.socket.send(new TextEncoder().encode("binary\n"))
          await waitFor(() => first.state.output.includes("reply:binary"))
          expect(first.state.output).toContain("reply:text")
          await client.pty.update({ location, ptyID: terminal.data.id, size: { rows: 31, cols: 93 } })
          first.socket.send("size\n")
          await waitFor(() => first.state.output.includes("31 93"))
          first.socket.close()
          await waitFor(() => first.state.closed)
          const second = await connect()
          try {
            expect(second.state.output).toContain("reply:text")
            expect(second.state.output).toContain("reply:binary")
            expect(second.state.frames.at(-1)).toBe("cursor")
            second.socket.send("reconnected\n")
            await waitFor(() => second.state.output.includes("reply:reconnected"))
            expect(first.state.output).not.toContain("reply:reconnected")
            second.socket.send("quit\n")
            await waitFor(() => second.state.closed)
            expect(second.state.code).toBe(1000)
            expect((await client.pty.get({ location, ptyID: terminal.data.id })).data.status).toBe("exited")
          } finally {
            second.socket.close()
          }
        } finally {
          first.socket.close()
        }
      })
    }),
  20_000,
)

async function waitFor(predicate: () => boolean) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (predicate()) return
    await Bun.sleep(20)
  }
  throw new Error("PTY transport did not reach the expected state")
}
