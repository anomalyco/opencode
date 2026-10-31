export * as ClientCertificate from "./client-certificate.js"

import path from "path"
import { Effect, Layer } from "effect"
import { FetchHttpClient, HttpClient, HttpClientError } from "effect/http"
import type { Entry } from "@opencode/schema/config"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { Config } from "./config.js"
import { WebSocketConstructor } from "./effect/websocket-constructor.js"
import { Wildcard } from "./util/wildcard.js"

export interface Rule {
  readonly hosts: readonly string[]
  readonly cert: string
  readonly key: string
  /** File holding the key's passphrase; read per request so the secret never enters a config document. */
  readonly passphraseFile?: string
}

/**
 * The rules from the highest-ranked config document that sets `network.client_certificates`. `Config` drops `network`
 * from project documents, so a repository cannot choose where the machine's certificate is presented.
 */
export function rules(entries: readonly Entry[], global: Pick<Global.Interface, "config" | "home">) {
  const source = entries.findLast(
    (entry) => entry.type === "document" && entry.info.network?.client_certificates !== undefined,
  )
  if (source?.type !== "document") return []
  const directory = source.path ? path.dirname(source.path) : global.config
  const resolve = (file: string) =>
    /^~[/\\]/.test(file) ? path.join(global.home, file.slice(2)) : path.resolve(directory, file)
  return (source.info.network?.client_certificates ?? []).map(
    (entry): Rule => ({
      hosts: entry.hosts.map(hostname),
      cert: resolve(entry.cert),
      key: resolve(entry.key),
      passphraseFile: entry.passphrase_file === undefined ? undefined : resolve(entry.passphrase_file),
    }),
  )
}

/** The last rule naming the URL's host, like permission rules; plain-HTTP URLs never match. */
export function match(rules: readonly Rule[], url: string) {
  if (!URL.canParse(url)) return
  const target = new URL(url)
  if (target.protocol !== "https:" && target.protocol !== "wss:") return
  const host = hostname(target.hostname)
  return rules.findLast((rule) => rule.hosts.some((pattern) => Wildcard.match(host, pattern)))
}

// `llm.example.` and `LLM.example` name the same host as `llm.example`, and `[0:0::1]` the same as `[::1]`.
const hostname = (host: string) =>
  host.startsWith("[") && URL.canParse(`https://${host}`)
    ? new URL(`https://${host}`).hostname
    : host.toLowerCase().replace(/\.$/, "")

/**
 * Wraps the fetch-backed HTTP client so each HTTPS request to a matching host presents its client certificate. Only
 * model requests use it: tools such as webfetch and URLs from project config must not borrow the machine's identity.
 * Rules come from the caller's Location `Config`, which every model request runs with.
 */
export const httpClientLayer = Layer.effect(
  HttpClient.HttpClient,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const global = yield* Global.Service
    const client = yield* HttpClient.HttpClient
    return HttpClient.transform(client, (effect, request) =>
      Effect.gen(function* () {
        const config = yield* Effect.serviceOption(Config.Service)
        if (config._tag === "None") return yield* effect
        const rule = match(rules(yield* config.value.entries(), global), request.url)
        if (!rule) return yield* effect
        const host = new URL(request.url).hostname
        const fail = (description: string) =>
          new HttpClientError.HttpClientError({ reason: new HttpClientError.TransportError({ request, description }) })
        if (typeof Bun === "undefined")
          return yield* fail(`A client certificate is configured for ${host}, but this runtime cannot present one`)
        // Bun also uses the request's TLS options for an HTTPS proxy's own handshake, which would present the
        // certificate to the proxy.
        const proxy = WebSocketConstructor.proxy(request.url)
        if (proxy?.startsWith("https:"))
          return yield* fail(
            `A client certificate is configured for ${host}, which would also be sent to the HTTPS proxy. Add ${host} to NO_PROXY or use an http:// proxy`,
          )
        const tls = yield* Effect.all({
          cert: fs.readFileString(rule.cert),
          key: fs.readFileString(rule.key),
          passphrase: rule.passphraseFile
            ? fs.readFileString(rule.passphraseFile).pipe(Effect.map((text) => text.replace(/[\r\n]+$/, "")))
            : Effect.succeed(undefined),
        }).pipe(Effect.mapError((error) => fail(`Could not read the client certificate for ${host}: ${error.message}`)))
        const fetch = yield* FetchHttpClient.Fetch
        return yield* effect.pipe(
          Effect.provideService(
            FetchHttpClient.Fetch,
            Object.assign(
              (input: Parameters<typeof globalThis.fetch>[0], init?: BunFetchRequestInit) =>
                fetch(input, {
                  ...init,
                  tls: { ...init?.tls, ...tls },
                  // Fetch would follow a redirect with the same TLS options, presenting the certificate to whatever
                  // host the server names. Only callers that handle redirects themselves see the 3xx.
                  redirect: init?.redirect === "manual" ? "manual" : "error",
                  // Pin the proxy decision checked above so Bun cannot choose a different one.
                  proxy: proxy ?? false,
                }),
              { preconnect: fetch.preconnect },
            ),
          ),
        )
      }),
    )
  }),
)
