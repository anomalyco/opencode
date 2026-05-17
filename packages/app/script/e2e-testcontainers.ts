import path from "node:path"
import { S3Client } from "bun"
import {
  GenericContainer,
  Network,
  Wait,
  type StartedNetwork,
  type StartedTestContainer,
} from "testcontainers"
import type { E2eInfraLayer } from "./e2e-infra"
import { e2eEmit, e2eEmitElapsed } from "../e2e/emit"

const pgUser = "veritly"
const pgPass = "veritly"
const pgDb = "veritly"

const bucket = "veritly-exchange"
const minioAccess = "veritlyminio"
const minioSecret = "veritlyminio_dev"
const s3Region = "us-east-1"
// Root packageManager is bun@1.3.10; Testcontainers must match for the same runtime APIs.
const e2eBunImage = "oven/bun:1.3.10"
/** Pinned: `latest` shifts behavior; log-based waits break across releases. */
const minioServerImage = "minio/minio:RELEASE.2025-09-07T16-13-09Z"

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function e2ePhase(t0: number, msg: string) {
  e2eEmitElapsed(t0, "e2e-tc", msg)
}

async function waitHttp(url: string, timeoutMs: number) {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5_000) })
      if (res.ok) return
    } catch {}
    await sleep(400)
  }
  throw new Error(`timeout waiting for ${url}`)
}

export type E2eTcLayer = {
  databaseUrl: string
  databaseUrlInternal: string
  /** Present when `infra` included `ollama` — `http://127.0.0.1:<port>` */
  ollamaBaseUrl?: string
  /** `http://ollama:11434` when Ollama runs on the same Docker network (sibling containers). */
  ollamaInternalBaseUrl?: string
  network: StartedNetwork
  stop(): Promise<void>
}

async function startPostgresOnNetwork(
  net: StartedNetwork,
): Promise<{ databaseUrl: string; databaseUrlInternal: string; c: StartedTestContainer }> {
  const t0 = Date.now()
  e2eEmit("[e2e-tc] → Postgres: pulling / starting postgres:16-alpine (usually quick if cached)…")
  const c = await new GenericContainer("postgres:16-alpine")
    .withEnvironment({
      POSTGRES_USER: pgUser,
      POSTGRES_PASSWORD: pgPass,
      POSTGRES_DB: pgDb,
    })
    .withNetwork(net)
    .withNetworkAliases("postgres")
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/))
    .withStartupTimeout(120_000)
    .start()
  e2ePhase(t0, "Postgres container ready (wait strategy passed).")
  const host = c.getHost()
  const port = c.getMappedPort(5432)
  const databaseUrl = `postgresql://${pgUser}:${pgPass}@${host}:${port}/${pgDb}`
  const databaseUrlInternal = `postgresql://${pgUser}:${pgPass}@postgres:5432/${pgDb}`
  e2eEmit("[e2e-tc] ✓ Postgres accepting connections.")
  return { databaseUrl, databaseUrlInternal, c }
}

async function startOllamaOnNetwork(
  net: StartedNetwork,
): Promise<{ baseUrl: string; internalBase: string; c: StartedTestContainer }> {
  const t0 = Date.now()
  e2eEmit(
    "[e2e-tc] → Ollama: pulling / starting ollama/ollama:latest — first-time image pull is often multi-GB and silent here; use Activity Monitor or `docker stats`.",
  )
  const c = await new GenericContainer("ollama/ollama:latest")
    .withNetwork(net)
    .withNetworkAliases("ollama")
    .withExposedPorts(11434)
    .withStartupTimeout(180_000)
    .start()
  e2ePhase(t0, "Ollama container started (image + port bind).")
  const host = c.getHost()
  const port = c.getMappedPort(11434)
  const baseUrl = `http://${host}:${port}`
  const internalBase = "http://ollama:11434"
  e2eEmit("[e2e-tc] → Ollama: container up; waiting for HTTP API…")
  await waitHttp(`${baseUrl}/api/tags`, 120_000)
  e2ePhase(t0, "Ollama HTTP /api/tags OK.")
  e2eEmit("[e2e-tc] → Ollama: pulling model llama3.2:1b inside container (minutes on first run; no progress bar here)…")
  const pull = await c.exec(["ollama", "pull", "llama3.2:1b"])
  if (pull.exitCode !== 0) {
    throw new Error(`ollama pull failed (exit ${pull.exitCode}): ${pull.stderr || pull.output}`)
  }
  if (pull.output.trim()) e2eEmit(`[e2e-tc] ollama pull output tail:\n${pull.output.slice(-2000)}`)
  const tags = await fetch(`${baseUrl}/api/tags`)
  if (!tags.ok) throw new Error(`ollama tags after pull: HTTP ${tags.status}`)
  const body = (await tags.json()) as { models?: Array<{ name: string }> }
  if (!body.models) throw new Error("ollama tags: missing models array")
  const names = body.models.map((m) => m.name)
  e2eEmit(`[e2e-tc] Ollama models: ${names.join(", ")}`)
  if (!names.some((n) => n.includes("llama3.2:1b"))) {
    throw new Error("llama3.2:1b not listed after pull")
  }
  e2ePhase(t0, "Ollama model llama3.2:1b ready.")
  return { baseUrl, internalBase, c }
}

/**
 * Postgres (+ Ollama when in `infra`). Same credentials as `docker-compose.e2e.yml`.
 */
export async function startE2eTestcontainers(infra: ReadonlySet<E2eInfraLayer>): Promise<E2eTcLayer> {
  const t0 = Date.now()
  const needOllama = infra.has("ollama")
  const containers: StartedTestContainer[] = []
  const net = await new Network().start()
  e2ePhase(t0, "Docker network created for E2E.")

  e2eEmit(
    `[e2e-tc] Testcontainers: Postgres${needOllama ? " + Ollama" : ""} on shared Docker network. Next lines explain each blocking step.`,
  )

  try {
    if (needOllama) {
      const [pg, om] = await Promise.all([startPostgresOnNetwork(net), startOllamaOnNetwork(net)])
      e2ePhase(t0, "Postgres + Ollama parallel start finished.")
      containers.push(pg.c, om.c)
      e2eEmit(`[e2e-tc] Postgres (Testcontainers): ${pg.databaseUrl}`)
      e2eEmit(`[e2e-tc] Ollama (Testcontainers): ${om.baseUrl}`)
      return {
        databaseUrl: pg.databaseUrl,
        databaseUrlInternal: pg.databaseUrlInternal,
        ollamaBaseUrl: om.baseUrl,
        ollamaInternalBaseUrl: om.internalBase,
        network: net,
        async stop() {
          for (const c of containers.reverse()) await c.stop()
          await net.stop()
        },
      }
    }

    const pg = await startPostgresOnNetwork(net)
    e2ePhase(t0, "Postgres-only path finished.")
    containers.push(pg.c)
    e2eEmit(`[e2e-tc] Postgres (Testcontainers): ${pg.databaseUrl}`)
    return {
      databaseUrl: pg.databaseUrl,
      databaseUrlInternal: pg.databaseUrlInternal,
      network: net,
      async stop() {
        for (const c of containers.reverse()) await c.stop()
        await net.stop()
      },
    }
  } catch (e) {
    const cleanup: unknown[] = []
    for (const c of containers.reverse()) {
      await c.stop().catch((err: unknown) => {
        e2eEmit(`[e2e-tc] Postgres/Ollama container stop failed: ${String(err)}`)
        cleanup.push(err)
      })
    }
    await net.stop().catch((err: unknown) => {
      e2eEmit(`[e2e-tc] Docker network stop failed: ${String(err)}`)
      cleanup.push(err)
    })
    if (cleanup.length) throw new AggregateError([e, ...cleanup], "startE2eTestcontainers failed; cleanup also failed")
    throw e
  }
}

const opencodeInternalApiPort = 4096

function stringEnv(src: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const k of Object.keys(src)) {
    const v = src[k]
    if (typeof v === "string") out[k] = v
  }
  return out
}

/**
 * OpenCode API in Docker: migrate → seed-e2e → HTTP server (same network as Postgres / Ollama).
 * Host binds `hostApiPort` → container `:4096`.
 *
 * The repo is bind-mounted read-only at `/app`. Use a **Linux** host (or CI) so `node_modules`
 * native addons match the container; macOS bind mounts can mismatch the Linux Bun image.
 */
export async function startOpencodeE2eContainer(opts: {
  repoRoot: string
  network: StartedNetwork
  hostApiPort: number
  configHostDir: string
  env: Record<string, string | undefined>
  /** When true, add `host.docker.internal` → `host-gateway` so the container can call Ollama on the host. */
  hostOllama: boolean
}): Promise<{ c: StartedTestContainer; stop(): Promise<void> }> {
  // Must stay one line: `JSON.stringify` + `sh -c` turns real newlines into a literal `\n` token Bun rejects.
  const serverBun = `import { Server } from "./src/server/server"; Server.listen({ port: ${opencodeInternalApiPort}, hostname: "0.0.0.0" })`

  const shell = [
    "mkdir -p /tmp/o/h /tmp/o/s /tmp/o/c /tmp/o/t && ",
    "export OPENCODE_TEST_HOME=/tmp/o/h XDG_DATA_HOME=/tmp/o/s XDG_CACHE_HOME=/tmp/o/c XDG_STATE_HOME=/tmp/o/t XDG_CONFIG_HOME=/config && ",
    "cd /app/packages/opencode && ",
    "bun run db:migrate && bun script/seed-e2e.ts && ",
    `exec bun -e ${JSON.stringify(serverBun)}`,
  ].join("")

  const t0 = Date.now()
  e2eEmit(
    `[e2e-tc] OpenCode Testcontainer: starting (host :${opts.hostApiPort} → container :${opencodeInternalApiPort}; blocks until migrate + seed + GET /readyz 200 — timeout 300s; use DEBUG=testcontainers* for Docker noise).`,
  )

  let box = new GenericContainer(e2eBunImage)
    .withNetwork(opts.network)
    .withBindMounts([
      { source: opts.repoRoot, target: "/app", mode: "ro" },
      { source: opts.configHostDir, target: "/config", mode: "rw" },
    ])
    .withWorkingDir("/app/packages/opencode")
    .withEnvironment(stringEnv(opts.env))
    .withExposedPorts({ container: opencodeInternalApiPort, host: opts.hostApiPort })
    .withCommand(["sh", "-c", shell])
    .withWaitStrategy(Wait.forHttp("/readyz", opencodeInternalApiPort))
    .withStartupTimeout(300_000)
  if (opts.hostOllama) {
    box = box.withExtraHosts([{ host: "host.docker.internal", ipAddress: "host-gateway" }])
  }
  const c = await box.start()
  e2ePhase(t0, "OpenCode Testcontainer is up (Testcontainers /readyz wait passed).")

  e2eEmit(`[e2e-tc] OpenCode (Testcontainer) → http://127.0.0.1:${opts.hostApiPort}`)
  return {
    c,
    stop: async () => {
      await c.stop()
    },
  }
}

async function minioOnNetwork(appsNetwork: StartedNetwork) {
  let child: StartedTestContainer | undefined
  let init: StartedTestContainer | undefined
  const t0 = Date.now()

  try {
    child = await new GenericContainer(minioServerImage)
      .withExposedPorts(9000)
      .withEnvironment({
        MINIO_ROOT_USER: minioAccess,
        MINIO_ROOT_PASSWORD: minioSecret,
        MINIO_API_CORS_ALLOW_ORIGIN: "*",
      })
      .withNetwork(appsNetwork)
      .withNetworkAliases("minio")
      .withCommand(["server", "/data", "--address", ":9000", "--console-address", ":9001"])
      // `forListeningPorts` also runs an *internal* port probe (`exec` + awk/nc/bash). MinIO’s image
      // often fails that probe while the host mapping is already up → hangs until startup timeout.
      .withWaitStrategy(Wait.forLogMessage(/MinIO Object Storage Server/))
      .withStartupTimeout(180_000)
      .start()

    e2ePhase(t0, "MinIO server container ready.")

    init = await new GenericContainer("minio/mc:latest")
      .withNetwork(appsNetwork)
      .withEntrypoint(["sh", "-c"])
      .withCommand([
        `for i in $(seq 1 60); do mc alias set local http://minio:9000 ${minioAccess} ${minioSecret} && break; sleep 1; done; mc mb local/${bucket} --ignore-existing`,
      ])
      .withWaitStrategy(Wait.forOneShotStartup())
      .withStartupTimeout(60_000)
      .start()
    e2ePhase(t0, "MinIO mc one-shot (alias + mb) finished.")
  } catch (err) {
    await init?.stop()
    await child?.stop()
    throw err
  }

  if (!child) throw new Error("minio container missing after start")

  return {
    child,
    init,
    endpoint: `http://${child.getHost()}:${child.getMappedPort(9000)}`,
  }
}

const veritlyUniverInternalPort = 8811

/** MinIO (Testcontainers) + univer-compat in Docker on one network. */
export type UniverE2eRuntime = {
  /** Host URL for Vite / Playwright (mapped port). */
  origin: string
  /** HTTP origin for peers on the same Docker network (OpenCode container health checks). */
  clusterUniverHttpOrigin: string
  env: Record<string, string>
  stop(): Promise<void>
}

/**
 * MinIO + mc on `appsNetwork` (alias `minio`), univer-compat in Bun (alias `veritly-univer`).
 * If `appsNetwork` is omitted, starts a dedicated network and tears it down in `stop()`.
 */
export async function startUniverE2e(
  root = path.resolve(import.meta.dir, "../../.."),
  appsNetwork?: StartedNetwork,
): Promise<UniverE2eRuntime> {
  const ownedNet = appsNetwork ? undefined : await new Network().start()
  const net = appsNetwork ?? ownedNet
  if (!net) throw new Error("univer e2e network missing")

  let minio: Awaited<ReturnType<typeof minioOnNetwork>> | undefined
  let compat: StartedTestContainer | undefined

  try {
    const t0 = Date.now()
    e2eEmit(`[e2e-tc] → Univer: MinIO on Docker network + bucket init (${minioServerImage})…`)
    minio = await minioOnNetwork(net)
    e2ePhase(t0, "MinIO + mc init containers started.")
    await minioReady(minio.endpoint)
    e2ePhase(t0, "MinIO S3 bucket responds to list.")

    e2eEmit("[e2e-tc] → Univer: starting univer-compat (Testcontainer, alias veritly-univer)…")
    const headerAuth = process.env.PLAYWRIGHT_UNIVER_HEADER_AUTH?.trim() === "1"
    const compatEnv: Record<string, string> = {
      PORT: String(veritlyUniverInternalPort),
      LISTEN_HOST: "0.0.0.0",
      UNIVER_COMPAT_S3_ENDPOINT: "http://minio:9000",
      UNIVER_COMPAT_S3_REGION: s3Region,
      UNIVER_COMPAT_S3_ACCESS_KEY: minioAccess,
      UNIVER_COMPAT_S3_SECRET_KEY: minioSecret,
      UNIVER_COMPAT_S3_BUCKET: bucket,
      UNIVER_COMPAT_PERSIST_EVERY_REV: "1",
    }
    if (!headerAuth) compatEnv.OPENCODE_E2E_USER_ID = "playwright-univer-e2e"

    compat = await new GenericContainer(e2eBunImage)
      .withNetwork(net)
      .withNetworkAliases("veritly-univer")
      .withExposedPorts(veritlyUniverInternalPort)
      .withBindMounts([{ source: root, target: "/app", mode: "ro" }])
      .withWorkingDir("/app/packages/univer-compat")
      .withEnvironment(compatEnv)
      .withCommand(headerAuth ? ["bun", "script/serve-header-test.ts"] : ["bun", "script/serve.ts"])
      .withWaitStrategy(Wait.forHttp("/readyz", veritlyUniverInternalPort))
      .withStartupTimeout(120_000)
      .start()
    e2ePhase(t0, "univer-compat container /readyz wait passed.")

    const mapped = compat.getMappedPort(veritlyUniverInternalPort)
    const origin = `http://127.0.0.1:${mapped}`
    const clusterUniverHttpOrigin = `http://veritly-univer:${veritlyUniverInternalPort}`

    const viteUniverEnv: Record<string, string> = headerAuth
      ? {
          VITE_UNIVER_BACKEND_URL: "same-origin",
          DEV_UNIVER_COMPAT_URL: origin,
          VERITLY_HEALTH_UNIVER_URL: origin,
        }
      : {
          VITE_UNIVER_BACKEND_URL: origin,
          VERITLY_HEALTH_UNIVER_URL: origin,
        }

    e2eEmit(`[e2e-tc] ✓ univer-compat ready (host: ${origin} cluster: ${clusterUniverHttpOrigin})`)

    return {
      origin,
      clusterUniverHttpOrigin,
      env: viteUniverEnv,
      async stop() {
        await compat?.stop()
        await minio?.init.stop()
        await minio?.child.stop()
        if (ownedNet) await ownedNet.stop()
      },
    }
  } catch (err) {
    await compat?.stop()
    await minio?.init.stop()
    await minio?.child.stop()
    if (ownedNet) await ownedNet.stop()
    throw err
  }
}

async function minioReady(endpoint: string) {
  const t0 = Date.now()
  e2eEmit("[e2e-tc] → MinIO: waiting until S3 listObjects succeeds (≤60s, quiet unless slow)…")
  const client = new S3Client({
    accessKeyId: minioAccess,
    secretAccessKey: minioSecret,
    bucket,
    endpoint,
    region: s3Region,
  })
  const end = Date.now() + 60_000
  let tries = 0
  while (Date.now() < end) {
    tries++
    if (tries % 20 === 0) e2ePhase(t0, `MinIO S3 poll still running (try ${tries})…`)
    try {
      await client.list({ maxKeys: 1 })
      e2ePhase(t0, "MinIO S3 list OK.")
      return
    } catch {
      await sleep(300)
    }
  }
  throw new Error(`MinIO bucket ${bucket} not ready`)
}

/** All Docker-backed E2E deps: Postgres (+ Ollama) + optional Univer MinIO stack + shared network for OpenCode-in-Docker. */
export type E2eDockerDeps = {
  databaseUrl: string
  databaseUrlInternal: string
  ollamaBaseUrl?: string
  ollamaInternalBaseUrl?: string
  network: StartedNetwork
  univer?: UniverE2eRuntime
  stop(): Promise<void>
}

export async function startE2eDockerDeps(
  infra: ReadonlySet<E2eInfraLayer>,
  repoDir: string,
): Promise<E2eDockerDeps> {
  const t0 = Date.now()
  const layers = [...infra].sort().join(",")
  e2eEmit(`[e2e-tc] startE2eDockerDeps layers: ${layers}`)
  const tc = await startE2eTestcontainers(infra)
  e2ePhase(t0, "Core Testcontainers (Postgres ± Ollama) ready.")
  if (!infra.has("univer")) {
    return {
      databaseUrl: tc.databaseUrl,
      databaseUrlInternal: tc.databaseUrlInternal,
      ollamaBaseUrl: tc.ollamaBaseUrl,
      ollamaInternalBaseUrl: tc.ollamaInternalBaseUrl,
      network: tc.network,
      univer: undefined,
      stop: () => tc.stop(),
    }
  }
  const uv = await startUniverE2e(repoDir, tc.network)
  e2ePhase(t0, "Univer stack (MinIO + compat) ready.")
  return {
    databaseUrl: tc.databaseUrl,
    databaseUrlInternal: tc.databaseUrlInternal,
    ollamaBaseUrl: tc.ollamaBaseUrl,
    ollamaInternalBaseUrl: tc.ollamaInternalBaseUrl,
    network: tc.network,
    univer: uv,
    async stop() {
      await uv.stop()
      await tc.stop()
    },
  }
}
