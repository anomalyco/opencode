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
    const password = yield* ServiceConfig.password()
    const urls = Option.isSome(input.url)
      ? [input.url.value]
      : (yield* Effect.tryPromise(() =>
          OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) }).server.get(),
        )).urls
    const info = { urls, username: "opencode", password }
    process.stdout.write(
      [
        "",
        `  URLs      ${info.urls[0] ?? "(none)"}`,
        ...info.urls.slice(1).map((url) => `            ${url}`),
        `  Username  ${info.username}`,
        `  Password  ${info.password}`,
        "",
        "  Scan to pair",
        "",
        renderUnicodeCompact(JSON.stringify(info), { border: 2 })
          .split(EOL)
          .map((line) => "  " + line)
          .join(EOL),
        "",
      ].join(EOL) + EOL,
    )

    if (Option.isSome(input.url)) return
    const hostname = new URL(endpoint.url).hostname
    if (!["localhost", "127.0.0.1", "[::1]"].includes(hostname)) return
    process.stderr.write(`  Run \`opencode service set hostname 0.0.0.0\` to access the service remotely.${EOL}${EOL}`)
  }),
)
