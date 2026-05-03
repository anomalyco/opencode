/**
 * Executor SDK tests call a real executor on the cluster (`executor-dev`) reachable after
 * port-forward. Default URL matches `packages/opencode/script/executor-dev-k8s-tunnel.sh`
 * (`127.0.0.1:7777`). Override with `VERITLY_EXECUTOR_URL` if you use another local port.
 */

import { Executor, type ExecutorSDK } from "../../src/executor/sdk"
import { Log } from "../../src/util/log"

var cached: ReturnType<typeof Log.create> | undefined

function journal(): ReturnType<typeof Log.create> {
  if (!cached) cached = Log.create({ service: "executor-fixture" })
  return cached
}

export interface ExecutorFixture {
  init(): Promise<void>
  terminate(): Promise<void>
  readonly sdk: ExecutorSDK
  readonly url: string
}

async function assertHealth(url: string) {
  const deadline = Date.now() + 90000
  let last = "unknown"
  let tries = 0
  journal().info("probing executor readiness", { url: `${url}/readyz` })
  while (Date.now() < deadline) {
    tries++
    try {
      const res = await fetch(`${url}/readyz`)
      if (!res.ok) {
        last = `http ${res.status}`
      } else {
        const data = (await res.json()) as { ok?: boolean }
        if (data.ok === true) return
        last = `payload ${JSON.stringify(data)}`
      }
    } catch (err) {
      last = err instanceof Error ? err.message : String(err)
    }
    journal().info("executor readiness retry", { tries, last })
    await Bun.sleep(1000)
  }
  throw new Error(`Executor not ready at ${url}/readyz after ${tries} tries: ${last}`)
}

class ExecutorFixtureImpl implements ExecutorFixture {
  #sdk: ExecutorSDK | null = null
  #url: string | null = null
  #initRun: Promise<void> | null = null

  async init() {
    if (this.#sdk && this.#url) return
    if (!this.#initRun) {
      this.#initRun = this.#runInit().catch((err) => {
        this.#initRun = null
        throw err
      })
    }
    await this.#initRun
  }

  async #runInit() {
    const url = process.env.VERITLY_EXECUTOR_URL?.trim() || "http://127.0.0.1:7777"
    journal().info("using executor url for tests", { url })
    await assertHealth(url)
    this.#url = url
    this.#sdk = Executor.create({ baseUrl: url })
  }

  get sdk() {
    if (!this.#sdk) throw new Error("ExecutorFixture: call init() before using sdk")
    return this.#sdk
  }

  get url() {
    if (!this.#url) throw new Error("ExecutorFixture: call init() before using url")
    return this.#url
  }

  async terminate() {
    this.#sdk = null
    this.#url = null
    this.#initRun = null
  }
}

let singleton: ExecutorFixtureImpl | null = null

export function executorFixture(): ExecutorFixture {
  if (!singleton) singleton = new ExecutorFixtureImpl()
  return singleton
}
