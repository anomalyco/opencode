/**
 * Executor VM tests — real Testcontainers: build docker/Dockerfile.executor from repo root,
 * run Firecracker inside the container (needs KVM where available; fails fast otherwise).
 */

import { join } from "node:path"
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers"
import { Log } from "../../src/util/log"

const log = Log.create({ service: "executor-testcontainer" })
/** Keep in sync with `packages/executor/src/server.ts` (`Executor API starting on port ${port}`) and `PORT` below. */
const EXECUTOR_HTTP_PORT = 7777
const EXECUTOR_READY_LOG = `Executor API starting on port ${EXECUTOR_HTTP_PORT}`

const BUILD_TIMEOUT_MS = Number(process.env.EXECUTOR_TEST_BUILD_TIMEOUT_MS ?? "360000")
const START_TIMEOUT_MS = Number(process.env.EXECUTOR_TEST_START_TIMEOUT_MS ?? "90000")
const HEALTH_TIMEOUT_MS = Number(process.env.EXECUTOR_TEST_HEALTH_TIMEOUT_MS ?? "90000")
function reqEnv(name: string) {
  const value = process.env[name]?.trim()
  if (value) return value
  throw new Error(`Missing ${name}`)
}
const VM_ACCEL = reqEnv("EXECUTOR_TEST_VM_ACCEL")

export interface ExecutorContext {
  container: StartedTestContainer
  url: string
}

function root() {
  return join(import.meta.dir, "../../../..")
}

async function withTimeout<T>(label: string, ms: number, work: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    work.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

/**
 * Build the executor image (needs packages/executor/output/vmlinux + rootfs.ext4) and start one container.
 */
export async function startExecutor(): Promise<ExecutorContext> {
  const ctx = root()
  const image = await withTimeout(
    "executor image build",
    BUILD_TIMEOUT_MS,
    GenericContainer.fromDockerfile(ctx, "docker/Dockerfile.executor").build("veritly-executor:testcontainers", {
      deleteOnExit: true,
    }),
  )

  const container = await withTimeout(
    "executor container start",
    START_TIMEOUT_MS,
    image
      .withExposedPorts(EXECUTOR_HTTP_PORT)
      .withPrivilegedMode()
      .withEnvironment({
        VM_ACCEL,
        PORT: String(EXECUTOR_HTTP_PORT),
      })
      .withWaitStrategy(Wait.forLogMessage(EXECUTOR_READY_LOG))
      .withStartupTimeout(START_TIMEOUT_MS)
      .start(),
  )

  const host = container.getHost()
  const port = container.getMappedPort(EXECUTOR_HTTP_PORT)
  const url = `http://${host}:${port}`

  const deadline = Date.now() + HEALTH_TIMEOUT_MS
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/readyz`)
      if (!res.ok) continue
      const body = (await res.json()) as { ok?: boolean }
      if (body.ok === true) {
        log.info("executor container healthy", { url })
        return { container, url }
      }
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 1500))
  }

  await container.stop()
  throw new Error(`Executor did not become healthy at ${url} (build needs packages/executor/output artifacts)`)
}

export async function stopExecutor(ctx: ExecutorContext | null) {
  if (!ctx?.container) return
  await ctx.container.stop()
  log.info("executor container stopped")
}
