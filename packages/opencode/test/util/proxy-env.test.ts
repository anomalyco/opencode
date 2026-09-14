import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { getProxyForUrl } from "../../src/util/proxy-env"

const KEYS = ["ALL_PROXY", "all_proxy", "HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy", "NO_PROXY", "no_proxy"] as const
const saved: Record<string, string | undefined> = {}

function snapshotEnv() {
  for (const key of KEYS) saved[key] = process.env[key]
}

function restoreEnv() {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
}

describe("getProxyForUrl loopback", () => {
  beforeEach(snapshotEnv)
  afterEach(restoreEnv)

  test("does not proxy loopback even when ALL_PROXY is set", () => {
    process.env.ALL_PROXY = "http://127.0.0.1:18764"
    process.env.HTTP_PROXY = "http://127.0.0.1:18764"
    delete process.env.NO_PROXY
    delete process.env.no_proxy
    expect(getProxyForUrl("http://127.0.0.1:8317/v1")).toBeUndefined()
    expect(getProxyForUrl("http://localhost:8317/v1")).toBeUndefined()
  })
})
