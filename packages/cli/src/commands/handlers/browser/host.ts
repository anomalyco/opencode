import { Effect, FileSystem } from "effect"
import path from "node:path"
import { Service } from "@opencode/client/effect/service"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { ServiceConfig } from "../../../services/service-config"
import { BrowserExtension } from "../../../services/browser-extension"

// Chrome native messaging: each message is a 4-byte little-endian length followed by JSON, on stdin and
// stdout. Nothing else may be written to stdout. Only the extension IDs in the host manifest can start it.
// - {type:"service"}: the background service's URL and password, starting the service if needed.
// - {type:"plugin", source}: installs the extension's opencode plugin (site_scripts and browsing tools)
//   into the plugins directory when it changed; opencode loads it from there.
export default Runtime.handler(
  Commands.commands.browser.commands.host,
  Effect.fn("cli.browser.host")(function* () {
    const fs = yield* FileSystem.FileSystem
    const files = yield* BrowserExtension.paths()
    const options = yield* ServiceConfig.options()
    const respond = Effect.fn("cli.browser.host.respond")(function* (message: unknown) {
      if (typeof message !== "object" || message === null || !("type" in message))
        return { ok: false, error: "Unknown request." }
      if (message.type === "plugin") {
        const source = "source" in message ? message.source : undefined
        if (typeof source !== "string" || !source || source.length > BrowserExtension.PLUGIN_MAX_BYTES)
          return { ok: false, error: "Invalid plugin source." }
        const current = yield* fs.readFileString(files.plugin).pipe(Effect.orElseSucceed(() => ""))
        if (current === source) return { ok: true, changed: false }
        yield* fs.makeDirectory(path.dirname(files.plugin), { recursive: true })
        yield* fs.writeFileString(files.plugin, source)
        return { ok: true, changed: true }
      }
      if (message.type !== "service") return { ok: false, error: "Unknown request." }
      const endpoint = yield* Service.ensure(options)
      yield* fs.makeDirectory(path.dirname(files.state), { recursive: true }).pipe(Effect.ignore)
      yield* fs.writeFileString(files.state, JSON.stringify({ connected: Date.now() })).pipe(Effect.ignore)
      const url = new URL(endpoint.url)
      // A service bound to every interface is reached on loopback; browsers refuse to fetch 0.0.0.0.
      if (url.hostname === "0.0.0.0" || url.hostname === "[::]") url.hostname = "127.0.0.1"
      return { ok: true, url: url.origin, password: endpoint.auth?.password ?? "" }
    })
    const reader = Bun.stdin.stream().getReader()
    let buffer = new Uint8Array(0)
    const fill = async () => {
      const chunk = await reader.read()
      if (chunk.done) return false
      const next = new Uint8Array(buffer.length + chunk.value.length)
      next.set(buffer)
      next.set(chunk.value, buffer.length)
      buffer = next
      return true
    }
    const read = async (): Promise<unknown> => {
      while (buffer.length < 4) if (!(await fill())) return undefined
      const length = new DataView(buffer.buffer, buffer.byteOffset, 4).getUint32(0, true)
      while (buffer.length < 4 + length) if (!(await fill())) return undefined
      const body = buffer.slice(4, 4 + length)
      buffer = buffer.slice(4 + length)
      return JSON.parse(new TextDecoder().decode(body))
    }
    while (true) {
      const message = yield* Effect.promise(read)
      if (message === undefined) return
      const reply = yield* respond(message).pipe(
        Effect.catch((error) => Effect.succeed({ ok: false, error: `Could not reach opencode: ${String(error)}` })),
      )
      const body = new TextEncoder().encode(JSON.stringify(reply))
      const header = new Uint8Array(4)
      new DataView(header.buffer).setUint32(0, body.length, true)
      process.stdout.write(header)
      process.stdout.write(body)
    }
  }),
)
