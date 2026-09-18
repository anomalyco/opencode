export * as ServerPairing from "./pairing"

import { KV } from "@opencode/core/kv"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Context, Effect, Layer } from "effect"

const portKey = "server.pairing.tailscale_https_port"

export interface Interface {
  readonly status: (urls: ReadonlyArray<string>) => Effect.Effect<{ available: boolean; urls: string[] }>
  readonly enable: (urls: ReadonlyArray<string>) => Effect.Effect<{ available: boolean; urls: string[] }>
  readonly disable: () => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/server/ServerPairing") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const kv = yield* KV.Service
    const state: { executable?: Promise<string | undefined> } = {}
    const getExecutable = () => (state.executable ??= resolveTailscale())
    const storedPort = Effect.fnUntraced(function* () {
      const value = yield* kv.get(portKey)
      if (typeof value !== "number" || !Number.isInteger(value) || value <= 0 || value > 65_535) return
      return value
    })
    const serve = (file: string, port: number, urls: ReadonlyArray<string>) =>
      Effect.promise(async () => {
        const target = urls[0]
        if (!target) throw new Error("The server did not report a connection URL")
        const endpoint = new URL(target)
        const served = await execute(file, [
          "serve",
          `--https=${port}`,
          "--bg",
          "--yes",
          `${endpoint.protocol}//${endpoint.host}`,
        ])
        const direct = tailscaleUrls(`${served.stdout}\n${served.stderr}`, port)
        if (direct.length) return direct
        const status = await execute(file, ["serve", "status"])
        const result = tailscaleUrls(`${status.stdout}\n${status.stderr}`, port)
        if (!result.length) throw new Error("Tailscale Serve did not report an HTTPS address")
        return result
      })

    return Service.of({
      status: Effect.fn("ServerPairing.status")(function* (urls) {
        const file = yield* Effect.promise(getExecutable)
        if (!file) return { available: false, urls: [] }
        const port = yield* storedPort()
        if (!port || !urls.length) return { available: true, urls: [] }
        return { available: true, urls: yield* serve(file, port, urls) }
      }),
      enable: Effect.fn("ServerPairing.enable")(function* (urls) {
        const file = yield* Effect.promise(getExecutable)
        if (!file) throw new Error("Tailscale is not installed")
        const port = (yield* storedPort()) ?? (yield* Effect.promise(availablePort))
        const result = yield* serve(file, port, urls)
        yield* kv.set(portKey, port)
        return { available: true, urls: result }
      }),
      disable: Effect.fn("ServerPairing.disable")(function* () {
        const file = yield* Effect.promise(getExecutable)
        const port = yield* storedPort()
        if (!file || !port) return
        yield* Effect.promise(() => execute(file, ["serve", `--https=${port}`, "--yes", "off"]))
        yield* kv.remove(portKey)
      }),
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [KV.node] })

async function execute(file: string, args: string[]) {
  const { execFile } = await import("node:child_process")
  const { promisify } = await import("node:util")
  return promisify(execFile)(file, args, {
    env: { ...process.env, TAILSCALE_BE_CLI: "1" },
    windowsHide: true,
  })
}

async function resolveTailscale() {
  const candidates =
    process.platform === "darwin"
      ? [
          "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
          ...(process.env.HOME ? [`${process.env.HOME}/Applications/Tailscale.app/Contents/MacOS/Tailscale`] : []),
          "/opt/homebrew/bin/tailscale",
          "/usr/local/bin/tailscale",
        ]
      : []
  const { access } = await import("node:fs/promises")
  const { constants } = await import("node:fs")
  const installed = (
    await Promise.all(
      candidates.map((file) =>
        access(file, constants.X_OK).then(
          () => file,
          () => undefined,
        ),
      ),
    )
  ).find((file) => file !== undefined)
  if (installed) return installed
  return execute(process.platform === "win32" ? "where.exe" : "which", ["tailscale"]).then(
    (result) =>
      result.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean),
    () => undefined,
  )
}

export function tailscaleUrls(output: string, port?: number) {
  return [
    ...new Set(
      (output.match(/https:\/\/[^\s|]+/g) ?? [])
        .map((value) => URL.parse(value.replace(/[),;]+$/, "")))
        .filter((url): url is URL => url?.protocol === "https:" && (port === undefined || url.port === String(port)))
        .map((url) => url.href.replace(/\/$/, "")),
    ),
  ]
}

async function availablePort() {
  const { createServer } = await import("node:net")
  return new Promise<number>((resolve, reject) => {
    const server = createServer()
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (address === null || typeof address === "string") {
        server.close()
        reject(new Error("Could not allocate a Tailscale HTTPS port"))
        return
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)))
    })
  })
}
