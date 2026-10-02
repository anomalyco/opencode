import { expect, test } from "bun:test"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { readProxyConfig } from "../../src/proxy/config-file"

function withTempConfig(contents: string, run: (directory: string) => void): void {
  const directory = mkdtempSync(path.join(tmpdir(), "proxy-config-"))
  writeFileSync(path.join(directory, "opencode.json"), contents)
  try {
    run(directory)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

test("reads the proxy section from a project opencode.json", () => {
  withTempConfig(JSON.stringify({ proxy: { url: "http://proxy.test:8080", auth: "ntlm" } }), (directory) => {
    const proxy = readProxyConfig(directory, path.join(directory, "no-global"))
    expect(proxy?.url).toBe("http://proxy.test:8080")
    expect(proxy?.auth).toBe("ntlm")
  })
})

test("returns undefined when no config sets a proxy", () => {
  withTempConfig(JSON.stringify({ model: "x" }), (directory) => {
    expect(readProxyConfig(directory, path.join(directory, "no-global"))).toBeUndefined()
  })
})
