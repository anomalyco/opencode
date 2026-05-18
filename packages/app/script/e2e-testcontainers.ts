/**
 * Docker-backed E2E for this package: **Postgres** (Testcontainers) + **Univer** (MinIO + univer-compat on the same network),
 * plus the OpenCode API Testcontainer. **Browser Vitest** specs call `useE2eStack()` (`test/browser/support/use-e2e-stack.ts`).
 * **Ollama** is expected on the **host** (`host.docker.internal:11434` from the OpenCode container).
 *
 * **Debugging:** `DEBUG=testcontainers*` on the same command as Vitest. Progress to stderr when `OPENCODE_E2E_LOG=1` (`e2e/emit.ts`).
 *
 * **Docker wiring:** `test/support/tc-wire-setup.ts` calls `wire-docker-context-for-tc.ts` (Colima Ryuk uses in-VM `/var/run/docker.sock`). Skip: `OPENCODE_SKIP_DOCKER_CONTEXT_WIRE=1`.
 *
 * **Reuse:** `{ reuse: true | false }` on `startE2eDockerDeps` / `useE2eStack` — `.withReuse()` and stable `opencode-e2e-bridge` when true; attach existing network on 409.
 */
import { spawn, type ChildProcess } from "node:child_process"
import path from "node:path"
import {
  GenericContainer,
  Network,
  type Uuid,
  Wait,
  getContainerRuntimeClient,
  StartedNetwork,
  type InspectResult,
  type StartedTestContainer,
} from "testcontainers"
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

const bridgeName = "opencode-e2e-bridge"
const e2eBridge: Uuid = { nextUuid: () => bridgeName }

function is409(e: unknown): boolean {
  if (!e || typeof e !== "object") return false
  const o = e as { statusCode?: number; message?: string; json?: { message?: string } }
  if (o.statusCode === 409) return true
  const m = `${o.message ?? ""} ${o.json?.message ?? ""}`
  return m.includes("409") || m.toLowerCase().includes("already exists")
}

function applyReuse(c: GenericContainer, reuse: boolean): GenericContainer {
  if (!reuse) return c
  return c.withReuse()
}

async function startE2eNet(reuse: boolean): Promise<StartedNetwork> {
  if (!reuse) return new Network().start()
  try {
    return await new Network(e2eBridge).start()
  } catch (e) {
    if (!is409(e)) throw e
    const client = await getContainerRuntimeClient()
    const d = client.container.dockerode
    const nets = await d.listNetworks()
    const hit = nets.find((n) => n.Name === bridgeName)
    if (!hit?.Id) throw new AggregateError([e as Error], `network ${bridgeName}: create conflict but network not found`)
    const raw = d.getNetwork(hit.Id)
    return new StartedNetwork(client, bridgeName, raw)
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function e2ePhase(t0: number, msg: string) {
  e2eEmitElapsed(t0, "e2e-tc", msg)
}

export type E2eTcLayer = {
  databaseUrl: string
  databaseUrlInternal: string
  network: StartedNetwork
  stop(): Promise<void>
}

async function startPostgresOnNetwork(
  net: StartedNetwork,
  reuse: boolean,
): Promise<{ databaseUrl: string; databaseUrlInternal: string; c: StartedTestContainer }> {
  const t0 = Date.now()
  e2eEmit("[e2e-tc] → Postgres: pulling / starting postgres:16-alpine (usually quick if cached)…")
  const c = await applyReuse(
    new GenericContainer("postgres:16-alpine")
      .withEnvironment({
        POSTGRES_USER: pgUser,
        POSTGRES_PASSWORD: pgPass,
        POSTGRES_DB: pgDb,
      })
      .withNetwork(net)
      .withNetworkAliases("postgres")
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/))
      .withStartupTimeout(120_000),
    reuse,
  ).start()
  e2ePhase(t0, "Postgres container ready (wait strategy passed).")
  const host = c.getHost()
  const port = c.getMappedPort(5432)
  const databaseUrl = `postgresql://${pgUser}:${pgPass}@${host}:${port}/${pgDb}`
  const databaseUrlInternal = `postgresql://${pgUser}:${pgPass}@postgres:5432/${pgDb}`
  e2eEmit("[e2e-tc] ✓ Postgres accepting connections.")
  return { databaseUrl, databaseUrlInternal, c }
}

/** Postgres only (same credentials as `docker-compose.e2e.yml`). Ollama is host-only for browser E2E. */
export async function startE2eTestcontainers(reuse: boolean): Promise<E2eTcLayer> {
  const t0 = Date.now()
  const containers: StartedTestContainer[] = []
  const net = await startE2eNet(reuse)
  e2ePhase(t0, "Docker network created for E2E.")

  e2eEmit(`[e2e-tc] Testcontainers: Postgres on shared Docker network (reuse=${reuse}).`)

  try {
    const pg = await startPostgresOnNetwork(net, reuse)
    e2ePhase(t0, "Postgres ready.")
    containers.push(pg.c)
    e2eEmit(`[e2e-tc] Postgres (Testcontainers): ${pg.databaseUrl}`)
    return {
      databaseUrl: pg.databaseUrl,
      databaseUrlInternal: pg.databaseUrlInternal,
      network: net,
      async stop() {
        for (const c of containers.reverse()) await c.stop()
        // Reuse uses a fixed bridge name; other workers or leftover containers may still be attached.
        if (!reuse) await net.stop()
      },
    }
  } catch (e) {
    const cleanup: unknown[] = []
    for (const c of containers.reverse()) {
      await c.stop().catch((err: unknown) => {
        e2eEmit(`[e2e-tc] Postgres container stop failed: ${String(err)}`)
        cleanup.push(err)
      })
    }
    if (!reuse) {
      await net.stop().catch((err: unknown) => {
        e2eEmit(`[e2e-tc] Docker network stop failed: ${String(err)}`)
        cleanup.push(err)
      })
    }
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

/** univer-compat uses `workosSessionResolver`; container must receive the same WorkOS + seal password as the app. */
function workosEnvForCompatContainer(): Record<string, string> {
  const apiKey = process.env.WORKOS_API_KEY?.trim()
  const clientId = process.env.WORKOS_CLIENT_ID?.trim()
  const cookiePassword = process.env.COOKIE_PASSWORD?.trim()
  if (!apiKey || !clientId || !cookiePassword) {
    throw new Error(
      "Univer Testcontainers: set WORKOS_API_KEY, WORKOS_CLIENT_ID, COOKIE_PASSWORD on the host (staging/test keys) so univer-compat can validate wos-session.",
    )
  }
  return {
    WORKOS_API_KEY: apiKey,
    WORKOS_CLIENT_ID: clientId,
    COOKIE_PASSWORD: cookiePassword,
  }
}

/**
 * OpenCode API in Docker: migrate → seed-e2e → HTTP server (same Docker network as Postgres / Univer).
 * Host binds `hostApiPort` → container `:4096`.
 *
 * The repo is bind-mounted **read-write** at `/app` so `bun run db:migrate` / tooling can create dirs
 * under the tree inside the container. Use a **Linux** host (or CI) so `node_modules` native addons
 * match the container; macOS bind mounts can mismatch the Linux Bun image.
 */
export async function startOpencodeE2eContainer(opts: {
  repoRoot: string
  network: StartedNetwork
  hostApiPort: number
  configHostDir: string
  env: Record<string, string | undefined>
  /** When true, add `host.docker.internal` → `host-gateway` so the container can call Ollama on the host. */
  hostOllama: boolean
  reuse: boolean
}): Promise<{ c: StartedTestContainer; stop(): Promise<void> }> {
  // Must stay one line: `JSON.stringify` + `sh -c` turns real newlines into a literal `\n` token Bun rejects.
  const serverBun = `import { Server } from "./src/server/server"; Server.listen({ port: ${opencodeInternalApiPort}, hostname: "0.0.0.0" })`

  const shell = [
    "mkdir -p /tmp/o/h /tmp/o/s /tmp/o/c /tmp/o/t && ",
    "export OPENCODE_TEST_HOME=/tmp/o/h XDG_DATA_HOME=/tmp/o/s XDG_CACHE_HOME=/tmp/o/c XDG_STATE_HOME=/tmp/o/t XDG_CONFIG_HOME=/config && ",
    "cd /app/packages/opencode && ",
    "bun ./src/storage/migrate-pg.ts && bun ./script/seed-e2e.ts && ",
    `exec bun -e ${JSON.stringify(serverBun)}`,
  ].join("")

  const t0 = Date.now()
  e2eEmit(
    `[e2e-tc] OpenCode Testcontainer: starting (host :${opts.hostApiPort} → container :${opencodeInternalApiPort}; blocks until migrate + seed + GET /readyz 200 — timeout 300s; use DEBUG=testcontainers* for Docker noise).`,
  )

  let box = new GenericContainer(e2eBunImage)
    .withNetwork(opts.network)
    .withBindMounts([
      { source: opts.repoRoot, target: "/app", mode: "rw" },
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
  const c = await applyReuse(box, opts.reuse).start()
  e2ePhase(t0, "OpenCode Testcontainer is up (Testcontainers /readyz wait passed).")

  e2eEmit(`[e2e-tc] OpenCode (Testcontainer) → http://127.0.0.1:${opts.hostApiPort}`)
  return {
    c,
    stop: async () => {
      await c.stop()
    },
  }
}

async function minioOnNetwork(appsNetwork: StartedNetwork, reuse: boolean) {
  let child: StartedTestContainer | undefined
  let init: StartedTestContainer | undefined
  const t0 = Date.now()

  try {
    child = await applyReuse(
      new GenericContainer(minioServerImage)
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
        .withStartupTimeout(180_000),
      reuse,
    ).start()

    e2ePhase(t0, "MinIO server container ready.")

    init = await applyReuse(
      new GenericContainer("minio/mc:latest")
        .withNetwork(appsNetwork)
        .withEntrypoint(["sh", "-c"])
        .withCommand([
          `for i in $(seq 1 60); do mc alias set local http://minio:9000 ${minioAccess} ${minioSecret} && break; sleep 1; done; mc mb local/${bucket} --ignore-existing`,
        ])
        .withWaitStrategy(Wait.forOneShotStartup())
        .withStartupTimeout(60_000),
      reuse,
    ).start()
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

/**
 * Extra lifecycle prints for the compat GenericContainer: after `docker create`, Testcontainers blocks on
 * host port-map inspect, then on the HTTP wait. `DEBUG=testcontainers*` still omits in-container Bun output,
 * so we also `docker logs -f` from the host until `containerStarted` fires.
 */
class UniverCompatE2eContainer extends GenericContainer {
  follow?: ChildProcess
  constructor(private readonly mark: number) {
    super(e2eBunImage)
  }

  protected override async containerCreated(id: string) {
    const cid = id.length > 12 ? id.slice(0, 12) : id
    e2eEmitElapsed(this.mark, "e2e-tc", `compat: docker create ok id=${cid}… (next: docker start → inspect until host port map)`)
    const follow = spawn("docker", ["logs", "-f", id], { stdio: ["ignore", "pipe", "pipe"] })
    this.follow = follow
    const onChunk = (buf: Buffer, stream: string) => {
      for (const line of buf.toString("utf8").split("\n")) {
        if (line.length > 0) e2eEmit(`[e2e-tc][compat ${cid} ${stream}] ${line}`)
      }
    }
    follow.stdout?.on("data", (b: Buffer) => onChunk(b, "stdout"))
    follow.stderr?.on("data", (b: Buffer) => onChunk(b, "stderr"))
    follow.on("error", (e) => {
      e2eEmit(`[e2e-tc][compat ${cid}] docker logs -f spawn error: ${String(e)}`)
    })
  }

  protected override async containerStarting(inspectResult: InspectResult, reused: boolean) {
    e2eEmitElapsed(
      this.mark,
      "e2e-tc",
      `compat: host port bindings visible reused=${reused} (next: TC wait strategy GET /readyz :${veritlyUniverInternalPort})`,
    )
    e2eEmit(`[e2e-tc] compat: inspectResult.ports=${JSON.stringify(inspectResult.ports)}`)
  }

  protected override async containerStarted(
    _c: StartedTestContainer,
    _inspect: InspectResult,
    reused: boolean,
  ) {
    e2eEmitElapsed(this.mark, "e2e-tc", `compat: startup finished reused=${reused} (stopping docker logs -f helper)`)
    this.follow?.kill("SIGTERM")
    this.follow = undefined
  }
}

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
  reuse = true,
): Promise<UniverE2eRuntime> {
  const ownedNet = appsNetwork ? undefined : await new Network().start()
  const net = appsNetwork ?? ownedNet
  if (!net) throw new Error("univer e2e network missing")

  let minio: Awaited<ReturnType<typeof minioOnNetwork>> | undefined
  let compat: StartedTestContainer | undefined

  try {
    const t0 = Date.now()
    e2eEmit(`[e2e-tc] → Univer: MinIO on Docker network + bucket init (${minioServerImage})…`)
    minio = await minioOnNetwork(net, reuse)
    e2ePhase(t0, "MinIO + mc init containers started.")
    await minioReady(minio.endpoint)
    e2ePhase(t0, "MinIO health ready.")

    e2eEmit("[e2e-tc] → Univer: starting univer-compat (Testcontainer, alias veritly-univer)…")
    e2eEmit(
      "[e2e-tc] compat: tip: set DEBUG=testcontainers* on the same command for Docker API noise from testcontainers.",
    )
    const compatEnv: Record<string, string> = {
      PORT: String(veritlyUniverInternalPort),
      LISTEN_HOST: "0.0.0.0",
      UNIVER_COMPAT_S3_ENDPOINT: "http://minio:9000",
      /** Presigned PUT/GET must use a host the browser resolves; SigV4 signs this `Host`. */
      UNIVER_COMPAT_S3_PRESIGN_ENDPOINT: minio.endpoint,
      UNIVER_COMPAT_S3_REGION: s3Region,
      UNIVER_COMPAT_S3_ACCESS_KEY: minioAccess,
      UNIVER_COMPAT_S3_SECRET_KEY: minioSecret,
      UNIVER_COMPAT_S3_BUCKET: bucket,
      UNIVER_COMPAT_PERSIST_EVERY_REV: "1",
      ...workosEnvForCompatContainer(),
    }

    e2ePhase(t0, "compat: building GenericContainer (network → aliases → exposed port → bind → workdir → env → cmd → http wait).")
    e2eEmit(`[e2e-tc] compat: image=${e2eBunImage} internalPort=${veritlyUniverInternalPort} bind=${root} → /app`)
    e2eEmit(`[e2e-tc] compat: cmd=bun ./script/serve.ts cwd=/app/packages/univer-compat`)
    e2eEmit(
      `[e2e-tc] compat: env keys=${Object.keys(compatEnv).sort().join(",")} (values omitted; includes WorkOS + S3)`,
    )

    e2ePhase(t0, "compat: calling GenericContainer.start() (blocks: pull if needed → create → connect net → start → port inspect → http /readyz).")
    compat = await applyReuse(
      new UniverCompatE2eContainer(t0)
        .withNetwork(net)
        .withNetworkAliases("veritly-univer")
        .withExposedPorts(veritlyUniverInternalPort)
        .withBindMounts([{ source: root, target: "/app", mode: "rw" }])
        .withWorkingDir("/app/packages/univer-compat")
        .withEnvironment(compatEnv)
        .withCommand(["bun", "./script/serve.ts"])
        .withWaitStrategy(Wait.forHttp("/readyz", veritlyUniverInternalPort))
        .withStartupTimeout(600_000),
      reuse,
    ).start()
    e2ePhase(t0, "univer-compat container /readyz wait passed.")

    const mapped = compat.getMappedPort(veritlyUniverInternalPort)
    const origin = `http://127.0.0.1:${mapped}`
    const clusterUniverHttpOrigin = `http://veritly-univer:${veritlyUniverInternalPort}`

    const viteUniverEnv: Record<string, string> = {
      VITE_UNIVER_BACKEND_URL: "same-origin",
      DEV_UNIVER_COMPAT_URL: origin,
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
  e2eEmit("[e2e-tc] → MinIO: waiting until /minio/health/ready succeeds (≤60s, quiet unless slow)…")
  const base = endpoint.replace(/\/+$/, "")
  const probe = `${base}/minio/health/ready`
  const end = Date.now() + 60_000
  let tries = 0
  while (Date.now() < end) {
    tries++
    if (tries % 20 === 0) e2ePhase(t0, `MinIO health poll still running (try ${tries})…`)
    try {
      const res = await fetch(probe, { signal: AbortSignal.timeout(5_000) })
      if (res.ok) {
        e2ePhase(t0, "MinIO health OK.")
        return
      }
    } catch {
      await sleep(300)
    }
  }
  throw new Error(`MinIO not ready at ${probe}`)
}

/** Postgres + Univer (MinIO + compat) on one network for OpenCode-in-Docker. Ollama is host-only. */
export type E2eDockerDeps = {
  databaseUrl: string
  databaseUrlInternal: string
  network: StartedNetwork
  univer: UniverE2eRuntime
  stop(): Promise<void>
}

export async function startE2eDockerDeps(
  repoDir: string,
  opts: { reuse: boolean } = { reuse: true },
): Promise<E2eDockerDeps> {
  const t0 = Date.now()
  e2eEmit(`[e2e-tc] startE2eDockerDeps (postgres + univer) reuse=${opts.reuse}`)
  const tc = await startE2eTestcontainers(opts.reuse)
  e2ePhase(t0, "Postgres Testcontainer ready.")
  const uv = await startUniverE2e(repoDir, tc.network, opts.reuse)
  e2ePhase(t0, "Univer stack (MinIO + compat) ready.")
  return {
    databaseUrl: tc.databaseUrl,
    databaseUrlInternal: tc.databaseUrlInternal,
    network: tc.network,
    univer: uv,
    async stop() {
      await uv.stop()
      await tc.stop()
    },
  }
}
