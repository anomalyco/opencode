import { confirm, intro, log, outro } from "@clack/prompts"
import { Effect } from "effect"
import { OpenCode } from "@opencode/client"
import { Service } from "@opencode/client/effect/service"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { ServerConnection } from "../../../services/server-connection"
import { handlePromptErrors, prompt, requireInteractive } from "../../../ui/prompt"
import { request } from "../auth/shared"

const location = { directory: process.cwd() }

export default Runtime.handler(
  Commands.commands.mcp.commands.trust,
  Effect.fn("cli.mcp.trust")((input) => run(input.url, input.force, input.yes).pipe(handlePromptErrors)),
)

const run = Effect.fn("cli.mcp.trust.run")(function* (url: string, force: boolean, yes: boolean) {
  intro("Trust an MCP server certificate")
  const { endpoint } = yield* ServerConnection.resolve()
  const client = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) })
  const inspect = yield* request((signal) => client.experimental.mcp.trust.inspect({ location, url }, { signal }))
  const cert = inspect.data.cert
  log.info(`Host: ${cert.host}:${cert.port}`)
  log.info(`Subject: ${cert.subject}`)
  log.info(`Valid until: ${new Date(cert.validTo).toISOString()}`)
  log.info(`SHA256 fingerprint: ${cert.fingerprint}`)
  const stored = inspect.data.stored
  if (stored) {
    if (stored.fingerprint === cert.fingerprint && !force) {
      log.info("This certificate is already trusted.")
      outro("Done")
      return
    }
    log.warn(`The certificate changed: the previously trusted fingerprint was ${stored.fingerprint}`)
  }
  if (!yes) {
    yield* requireInteractive("Pass --yes when trusting a certificate without an interactive terminal")
    const ok = yield* prompt(() => confirm({ message: "Trust this certificate for this project?" }))
    if (!ok) {
      outro("Cancelled")
      return
    }
  }
  const result = yield* request((signal) =>
    client.experimental.mcp.trust.pin({ location, url, force, expectFingerprint: cert.fingerprint }, { signal }),
  )
  outro(result.data.replaced ? "Re-pinned the certificate" : "Trusted the certificate")
})
