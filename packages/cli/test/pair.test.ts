import { expect, test } from "bun:test"
import { EOL } from "node:os"
import path from "node:path"
import { renderUnicodeCompact } from "uqr"
import { isolatedEnv } from "./fixture/environment"
import { tmpdir } from "./fixture/tmpdir"

test.each([
  { args: [], urls: ["http://192.168.1.20:4096"], hint: true },
  { args: ["--url", "https://machine.tailnet.ts.net/"], urls: ["https://machine.tailnet.ts.net"], hint: false },
  { args: ["--url", "https://proxy.example/opencode/"], urls: ["https://proxy.example/opencode"], hint: false },
])("pair advertises $urls with the existing service password", async ({ args, urls, hint }) => {
  await using directory = await tmpdir()
  const password = "pair-test-password"
  using server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(request) {
      if (request.headers.get("authorization") !== `Basic ${btoa(`opencode:${password}`)}`)
        return new Response(null, { status: 401 })
      if (new URL(request.url).pathname === "/api/health")
        return Response.json({ healthy: true, version: "pair-fixture", pid: process.pid })
      if (new URL(request.url).pathname === "/api/server") return Response.json({ urls: ["http://192.168.1.20:4096"] })
      return new Response(null, { status: 404 })
    },
  })
  const registration = { url: server.url.origin, pid: process.pid, version: "pair-fixture", password }
  await Bun.write(path.join(directory.path, "state/opencode/service-local.json"), JSON.stringify(registration))
  await Bun.write(path.join(directory.path, "config/service-local.json"), JSON.stringify({ password }))

  const result = await cli(["pair", ...args], directory.path)
  expect(result.exitCode).toBe(0)
  expect(result.stdout).toContain(`URLs      ${urls[0]}`)
  expect(result.stdout).toContain(`Password  ${password}`)
  expect(result.stdout).toContain(
    renderUnicodeCompact(JSON.stringify({ urls, username: "opencode", password }), { border: 2 })
      .split(EOL)
      .join(EOL + "  "),
  )
  expect(result.stderr.includes("service set hostname")).toBe(hint)
  expect(await Bun.file(path.join(directory.path, "state/opencode/service-local.json")).json()).toEqual(registration)
})

test.each([
  "not-a-url",
  "ftp://machine.example",
  "https://user:password@machine.example",
  "https://machine.example?token=secret",
  "https://machine.example#fragment",
])("pair rejects invalid advertised URL %s before starting a service", async (url) => {
  await using directory = await tmpdir()
  const result = await cli(["pair", "--url", url], directory.path)
  expect(result.exitCode).not.toBe(0)
  expect(result.stderr).toContain("Expected an HTTP(S) server URL")
  expect(await Bun.file(path.join(directory.path, "state/opencode/service-local.json")).exists()).toBe(false)
})

async function cli(args: string[], root: string) {
  const child = Bun.spawn([process.execPath, "run", "src/index.ts", ...args], {
    cwd: path.join(import.meta.dir, ".."),
    env: isolatedEnv(root),
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { stdout, stderr, exitCode }
}
