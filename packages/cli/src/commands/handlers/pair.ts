import { cancel, confirm, isCancel, log } from "@clack/prompts"
import { EOL } from "os"
import { Effect, Option, Schedule } from "effect"
import { Service } from "@opencode/client/effect/service"
import { OpenCode } from "@opencode/client/promise"
import { renderUnicodeCompact } from "@opencode/util/qr"
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
    if (input.remote && config.remote === undefined) {
      if (!(yield* remoteConsent(config, input))) return
      // Changing the setting restarts the service, and the ensure below starts it again with the tunnel.
      yield* ServiceConfig.set("remote", "true")
    }
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
              // renderUnicodeCompact separates rows with "\n" on every platform, so splitting on EOL ("\r\n" on Windows) indents only the first row.
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

export const remoteWarning = [
  "This will expose your OpenCode server to the internet.",
  "Traffic is end-to-end encrypted, and access requires your server password.",
  "To pair locally instead, run `opencode pair` without the --remote flag.",
].join(EOL)

export interface RemoteConsentPrompt {
  readonly interactive: () => boolean
  readonly confirm: () => Promise<boolean | symbol>
}

const terminalPrompt: RemoteConsentPrompt = {
  interactive: () => Boolean(process.stdin.isTTY && process.stdout.isTTY),
  confirm: () => confirm({ message: "Expose your server to the internet?", initialValue: true }),
}

// Remote access is only explained and accepted the first time it is turned on; once accepted, pairing goes straight
// through. Returns whether remote access may be enabled.
export const remoteConsent = Effect.fn("cli.pair.remote-consent")(function* (
  config: ServiceConfig.Info,
  input: { readonly yes: boolean },
  terminal: RemoteConsentPrompt = terminalPrompt,
) {
  if (config.remote !== undefined || config.remoteAccepted === true) return true
  if (!input.yes && !terminal.interactive()) {
    process.stderr.write([remoteWarning, "Run interactively or pass --yes to continue."].join(EOL) + EOL)
    process.exitCode = 1
    return false
  }
  log.warn(remoteWarning)
  if (!input.yes) {
    const accepted = yield* Effect.promise(terminal.confirm)
    if (isCancel(accepted)) {
      cancel("Remote access was not enabled. To pair locally, run `opencode pair`.")
      process.exitCode = 130
      return false
    }
    if (accepted !== true) {
      log.info("Remote access was not enabled. To pair locally, run `opencode pair`.")
      return false
    }
  }
  yield* ServiceConfig.acceptRemote()
  return true
})

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
    const route = (yield* ServiceConfig.read()).remote?.route
    const hostname = route === undefined ? undefined : yield* RemoteTunnel.hostname(route)
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
        Effect.fail(
          new Error(
            [
              "Timed out waiting for the remote tunnel; run `opencode pair --remote` again to retry.",
              // The service may not inherit the shell's environment, and Bun ignores the Windows system (WinINET) proxy.
              "Behind an HTTP proxy, give the background service its address with `opencode service set env HTTPS_PROXY <url>` (and `NO_PROXY` for hosts to reach directly).",
            ].join(EOL),
          ),
        ),
    }),
  )
})

function isLoopback(hostname: string) {
  return (
    hostname === "localhost" || hostname.endsWith(".localhost") || hostname.startsWith("127.") || hostname === "[::1]"
  )
}
