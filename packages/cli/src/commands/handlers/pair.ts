import { EOL } from "os"
import { Effect, Option, Schedule } from "effect"
import { Service } from "@opencode/client/effect/service"
import { OpenCode } from "@opencode/client/promise"
import { renderUnicodeCompact } from "uqr"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"
import { RemoteTunnel } from "../../services/remote-tunnel"
import { ServiceConfig } from "../../services/service-config"

export default Runtime.handler(
  Commands.commands.pair,
  Effect.fn("cli.pair")(function* (input: Runtime.Input<typeof Commands.commands.pair>) {
    const config = yield* ServiceConfig.read()
    if (config.disabled === true)
      return yield* Effect.fail(
        new Error("Pairing requires the background service; run `opencode service unset disabled` first"),
      )
    if (input.remote && Option.isSome(input.url))
      return yield* Effect.fail(new Error("--remote cannot be combined with --url"))
    // Changing the setting restarts the service, and the ensure below starts it again with the tunnel.
    if (input.remote && config.remote !== true) yield* ServiceConfig.set("remote", "true")
    const endpoint = yield* Service.ensure(yield* ServiceConfig.options())
    const client = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) })
    const urls = yield* pairingURLs(client, input)
    const pairing = yield* Effect.tryPromise(() => client.server.pair())
    const links = urls.map((url) => new URL(`/auth/connect/${pairing.code}`, url).href)
    // Loopback URLs are useless to the scanning device, so the QR code only carries reachable addresses.
    const remote = urls.filter((url) => !isLoopback(new URL(url).hostname))
    process.stdout.write(
      [
        "",
        `  Open a link to connect. Links work once and expire in ${Math.round(pairing.expires_in / 60)} minutes.`,
        "",
        ...(links.length ? links.map((link) => `  ${link}`) : ["  (no server URLs)"]),
        ...(remote.length
          ? [
              "",
              // uqr separates rows with "\n" on every platform, so splitting on EOL ("\r\n" on Windows) indents only the first row.
              renderUnicodeCompact(JSON.stringify({ code: pairing.code, urls: remote }), {
                border: 2,
              })
                .split("\n")
                .map((line) => "  " + line)
                .join(EOL),
            ]
          : []),
        "",
      ].join(EOL) + EOL,
    )

    if (input.remote || Option.isSome(input.url)) return
    const url = new URL(endpoint.url)
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return
    process.stderr.write(
      [
        `  Over SSH? Forward the port, then open the link on your machine:`,
        `  ssh -L ${url.port}:${url.hostname}:${url.port} <host>`,
        `  If port ${url.port} is busy locally, forward another port and use it in the link.`,
        "",
        "  To connect from other devices, run `opencode service set hostname 0.0.0.0`.",
        "",
      ].join(EOL) + EOL,
    )
  }),
)

const pairingURLs = Effect.fnUntraced(function* (
  client: ReturnType<typeof OpenCode.make>,
  input: Runtime.Input<typeof Commands.commands.pair>,
) {
  if (input.remote) return [yield* remoteURL(client)]
  if (Option.isSome(input.url)) return [input.url.value]
  return (yield* Effect.tryPromise(() => client.server.info())).urls
})

// The service attaches the tunnel in the background, so wait for its URL to appear in server info.
const remoteURL = Effect.fnUntraced(function* (client: ReturnType<typeof OpenCode.make>) {
  const tunnelURL = Effect.gen(function* () {
    const hostname = yield* RemoteTunnel.hostname()
    const info = yield* Effect.tryPromise(() => client.server.info())
    const url = info.urls.find((candidate) => hostname !== undefined && new URL(candidate).hostname === hostname)
    if (url === undefined) return yield* Effect.fail(new Error("Remote tunnel is not ready"))
    return url
  })
  return yield* tunnelURL.pipe(
    Effect.retry({ schedule: Schedule.spaced("1 second") }),
    Effect.timeoutOrElse({
      duration: "3 minutes",
      orElse: () =>
        Effect.fail(new Error("Timed out waiting for the remote tunnel; run `opencode pair --remote` again to retry")),
    }),
  )
})

function isLoopback(hostname: string) {
  return (
    hostname === "localhost" || hostname.endsWith(".localhost") || hostname.startsWith("127.") || hostname === "[::1]"
  )
}
