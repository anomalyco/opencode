import { EOL } from "os"
import { Effect, Option } from "effect"
import { Service } from "@opencode/client/effect/service"
import { OpenCode } from "@opencode/client/promise"
import { renderUnicodeCompact } from "uqr"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"
import { ServiceConfig } from "../../services/service-config"

export default Runtime.handler(
  Commands.commands.pair,
  Effect.fn("cli.pair")(function* (input: Runtime.Input<typeof Commands.commands.pair>) {
    const endpoint = yield* Service.ensure(yield* ServiceConfig.options())
    const client = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) })
    const urls = Option.isSome(input.url)
      ? [input.url.value]
      : (yield* Effect.tryPromise(() => client.server.info())).urls
    const pairing = yield* Effect.tryPromise(() => client.server.pair())
    const links = urls.map((url) => new URL(`/auth/connect/${pairing.code}`, url).href)
    process.stdout.write(
      [
        "",
        `  Open a link to connect. Links work once and expire in ${Math.round(pairing.expires_in / 60)} minutes.`,
        "",
        ...(links.length ? links.map((link) => `  ${link}`) : ["  (no server URLs)"]),
        ...(links[0]
          ? [
              "",
              renderUnicodeCompact(links[0], { border: 2 })
                .split(EOL)
                .map((line) => "  " + line)
                .join(EOL),
            ]
          : []),
        "",
      ].join(EOL) + EOL,
    )

    if (Option.isSome(input.url)) return
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
