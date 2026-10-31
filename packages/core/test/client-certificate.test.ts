import path from "path"
import fs from "fs/promises"
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { Effect, Layer, Option, Schema } from "effect"
import { ConfigNetwork } from "@opencode/schema/config/network"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http"
import { RequestExecutor } from "@opencode/ai/route"
import { ClientCertificate } from "@opencode/core/client-certificate"
import { Config } from "@opencode/core/config"
import { AbsolutePath } from "@opencode/core/schema"
import { Document, Info } from "@opencode/schema/config"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNodePlatform } from "@opencode/core/effect/app-node-platform"
import { httpClient } from "@opencode/util/effect/app-node-platform"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { withEnv } from "./fixture/env"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const it = testEffect(Layer.empty)
// The certificates are generated per run; a runner without OpenSSL lacks the capability, not the behavior.
const itWithOpenSSL = Bun.which("openssl") ? it.live : it.live.skip

let root: Awaited<ReturnType<typeof tmpdir>>
let ca = ""
let server: Bun.Server<undefined>

beforeAll(async () => {
  root = await tmpdir()
  if (!Bun.which("openssl")) return
  const certs = path.join(root.path, "system", "certs")
  await fs.mkdir(certs, { recursive: true })
  const openssl = (...args: string[]) =>
    Bun.$`openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -days 2 ${args}`.cwd(certs).quiet()
  await openssl("-nodes", "-keyout", "ca.key", "-out", "ca.pem", "-subj", "/CN=OpenCode Test CA")
  await Promise.all([
    openssl(
      ...["-CA", "ca.pem", "-CAkey", "ca.key", "-nodes", "-keyout", "server.key", "-out", "server.pem"],
      ...["-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1"],
    ),
    openssl(
      ...["-CA", "ca.pem", "-CAkey", "ca.key", "-passout", "pass:secret", "-keyout", "client.key"],
      ...["-out", "client.pem", "-subj", "/CN=client", "-addext", "extendedKeyUsage=clientAuth"],
    ),
  ])
  await Bun.write(path.join(certs, "passphrase"), "secret\n")
  ca = await Bun.file(path.join(certs, "ca.pem")).text()
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    tls: {
      cert: Bun.file(path.join(certs, "server.pem")),
      key: Bun.file(path.join(certs, "server.key")),
      ca,
      requestCert: true,
      rejectUnauthorized: true,
    },
    fetch: (request) =>
      new URL(request.url).pathname === "/redirect"
        ? Response.redirect(`https://127.0.0.1:${server.port}/`, 302)
        : new Response("ok"),
  })
})

afterAll(async () => {
  await server?.stop(true)
  await root[Symbol.asyncDispose]()
})

const document = (directory: string, config: unknown) =>
  new Document({
    type: "document",
    path: AbsolutePath.make(path.join(root.path, directory, "opencode.json")),
    info: Schema.decodeUnknownSync(Info)(config),
  })

/** The Location config a model request runs with. */
const configured = (...documents: Document[]) => Effect.provide(Config.testLayer(documents))

// The key is encrypted, so a request only succeeds when the passphrase reaches the TLS options too.
const certificate = (hosts: string[]) =>
  document("system", {
    network: {
      client_certificates: [
        { hosts, cert: "certs/client.pem", key: "certs/client.key", passphrase_file: "certs/passphrase" },
      ],
    },
  })

const global = () => ({ config: path.join(root.path, "global"), home: path.join(root.path, "home") })

const layer = () =>
  AppNodeBuilder.build(LayerNode.group([LayerNodePlatform.requestExecutor, httpClient]), [
    Global.node.replace(Global.layerWith(global())),
  ])

// The test CA only verifies the server; trust for real gateways comes from the system store or NODE_EXTRA_CA_CERTS.
const trusted = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.provideService(
      FetchHttpClient.Fetch,
      Object.assign(
        (input: Parameters<typeof fetch>[0], init?: BunFetchRequestInit) =>
          fetch(input, { ...init, tls: { ca, ...init?.tls } }),
        { preconnect: fetch.preconnect },
      ),
    ),
  )

/** A model request, the only kind that presents client certificates. */
const get = (host: string, pathname = "/") =>
  Effect.gen(function* () {
    const executor = yield* RequestExecutor.Service
    const response = yield* executor.execute(HttpClientRequest.get(`https://${host}:${server?.port ?? 443}${pathname}`))
    return yield* response.text
  }).pipe(trusted)

describe("ClientCertificate", () => {
  test("accepts hostnames and rejects URLs, ports, and wildcard-only patterns", () => {
    const valid = (host: string) =>
      Option.isSome(
        Schema.decodeUnknownOption(ConfigNetwork.ClientCertificate)({ hosts: [host], cert: "c.pem", key: "k.pem" }),
      )
    expect(["llm.corp.test", "*.corp.test", "llm-?.corp.test", "10.0.0.1", "[::1]"].filter(valid)).toHaveLength(5)
    expect(
      ["https://llm.corp.test", "llm.corp.test:8443", "llm.corp.test/v1", "*", "*.*", "::1"].filter(valid),
    ).toEqual([])
  })

  itWithOpenSSL("presents the certificate to a matching host", () =>
    get("localhost").pipe(
      configured(certificate(["LOCALHOST"])),
      Effect.map((body) => expect(body).toBe("ok")),
      Effect.provide(layer()),
    ),
  )

  itWithOpenSSL("does not present the certificate to other hosts", () =>
    Effect.flip(get("127.0.0.1")).pipe(configured(certificate(["localhost"])), Effect.provide(layer())),
  )

  itWithOpenSSL("does not present the certificate on requests other than model requests", () =>
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient
      return yield* Effect.flip(client.get(`https://localhost:${server.port}/`).pipe(trusted))
    }).pipe(configured(certificate(["localhost"])), Effect.provide(layer())),
  )

  it.live("refuses to send the certificate through an HTTPS proxy", () =>
    withEnv(
      // Windows env names are case-insensitive, so clearing `https_proxy` would also clear `HTTPS_PROXY`.
      {
        HTTPS_PROXY: "https://proxy.test",
        https_proxy: "https://proxy.test",
        NO_PROXY: undefined,
        no_proxy: undefined,
      },
      () =>
        Effect.flip(get("llm.corp.test")).pipe(
          configured(certificate(["llm.corp.test"])),
          Effect.map((error) => expect(String(error)).toContain("NO_PROXY")),
        ),
    ).pipe(Effect.provide(layer())),
  )

  itWithOpenSSL("fails instead of following a redirect with the certificate", () =>
    Effect.flip(get("localhost", "/redirect")).pipe(
      configured(certificate(["localhost", "127.0.0.1"])),
      Effect.map((error) => expect(String(error.cause)).toContain("Redirect")),
      Effect.provide(layer()),
    ),
  )

  test("takes rules from the highest-ranked document and resolves its paths", () => {
    const user = document("global", {
      network: { client_certificates: [{ hosts: ["user.test"], cert: "~/user.pem", key: "user.key" }] },
    })
    expect(ClientCertificate.rules([user, document("system", {})], global())).toEqual([
      {
        hosts: ["user.test"],
        cert: path.join(root.path, "home", "user.pem"),
        key: path.join(root.path, "global", "user.key"),
        passphraseFile: undefined,
      },
    ])
    const rules = ClientCertificate.rules(
      [
        user,
        document("system", {
          network: {
            client_certificates: [
              { hosts: ["*.corp.test", "[0:0:0:0:0:0:0:1]"], cert: "/etc/corp.pem", key: "corp.key" },
            ],
          },
        }),
      ],
      global(),
    )
    expect(rules).toEqual([
      {
        hosts: ["*.corp.test", "[::1]"],
        cert: path.resolve(root.path, "/etc/corp.pem"),
        key: path.join(root.path, "system", "corp.key"),
        passphraseFile: undefined,
      },
    ])
    expect(ClientCertificate.match(rules, "https://api.corp.test/v1")).toBe(rules[0])
    expect(ClientCertificate.match(rules, "https://API.corp.test./v1")).toBe(rules[0])
    expect(ClientCertificate.match(rules, "https://[::1]/")).toBe(rules[0])
    expect(ClientCertificate.match(rules, "http://api.corp.test/v1")).toBeUndefined()
    expect(ClientCertificate.match(rules, "https://user.test/v1")).toBeUndefined()
    const specific = { ...rules[0], hosts: ["llm.corp.test"] }
    expect(ClientCertificate.match([...rules, specific], "https://llm.corp.test/v1")).toBe(specific)
  })
})
