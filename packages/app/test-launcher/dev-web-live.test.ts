import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, mkdtempSync, rmSync } from "fs"
import { get } from "http"
import { tmpdir } from "os"
import { delimiter, join } from "path"

const launcher = join(import.meta.dir, "../script/dev-web-live.ts")
const localUrl = "http://127.0.0.1:4444"
const fixtures: string[] = []

afterEach(() => {
  fixtures.splice(0).forEach((fixture) => rmSync(fixture, { recursive: true, force: true }))
})

describe("dev:web:live", () => {
  test("fails clearly when the installed service is unavailable", async () => {
    const result = await runLauncher("unavailable")

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain("installed opencode2 service is unavailable")
  })

  test("rejects malformed service discovery output", async () => {
    const result = await runLauncher("malformed")

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain("did not return a valid HTTP URL")
  })

  test("fails clearly when port 4444 is occupied", async () => {
    using _server = Bun.serve({ hostname: "127.0.0.1", port: 4444, fetch: () => new Response() })
    const result = await runLauncher("available")

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain("Port 4444 is already in use")
  })

  test("launches Vite with authenticated browser bootstrap and cleans up on exit", async () => {
    const fixture = await createFixture()
    const marker = join(fixture.directory, "browser.json")
    const serviceMarker = join(fixture.directory, "service.txt")
    const child = spawnLauncher(fixture, "available", {
      BROWSER: fixture.browser,
      OPENCODE_BROWSER_MARKER: marker,
      OPENCODE_SERVICE_MARKER: serviceMarker,
    })

    try {
      await waitFor(() => Bun.file(marker).exists())
      expect(await Bun.file(marker).json()).toEqual({
        origin: "http://localhost:4444",
        username: "opencode",
        passwordMatches: true,
      })
      expect(await Bun.file(serviceMarker).text()).toBe("service status\nservice get password\n")
      const entry = await readUrl(`${localUrl}/src/entry.tsx`)
      expect(entry).toContain('"127.0.0.1"')
      expect(entry).toContain('"54321"')
    } finally {
      child.kill("SIGTERM")
    }

    const result = await output(child)
    expect(result.stdout + result.stderr).not.toContain("live-web-secret")
    expect(result.stdout + result.stderr).not.toContain("auth_token")
    using port = Bun.serve({ hostname: "127.0.0.1", port: 4444, fetch: () => new Response() })
    expect(port.url.origin).toBe(localUrl)
  }, 15_000)
})

async function runLauncher(service: "available" | "malformed" | "unavailable") {
  const fixture = await createFixture()
  return output(spawnLauncher(fixture, service))
}

function spawnLauncher(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  service: "available" | "malformed" | "unavailable",
  env?: Record<string, string>,
) {
  return Bun.spawn([process.execPath, launcher], {
    env: {
      ...process.env,
      PATH: `${fixture.directory}${delimiter}${process.env.PATH}`,
      OPENCODE_TEST_SERVICE: service,
      ...env,
    },
    stdout: "pipe",
    stderr: "pipe",
  })
}

async function output(child: ReturnType<typeof spawnLauncher>) {
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { stdout, stderr, exitCode }
}

async function createFixture() {
  const directory = mkdtempSync(join(tmpdir(), "opencode-live-web-"))
  fixtures.push(directory)
  const browser = await writeExecutable(
    directory,
    "browser",
    `
const url = new URL(Bun.argv[2])
const [username, password] = atob(url.searchParams.get("auth_token")).split(":")
await Bun.write(process.env.OPENCODE_BROWSER_MARKER, JSON.stringify({
  origin: url.origin,
  username,
  passwordMatches: password === "live-web-secret",
}))
`,
  )
  await writeExecutable(
    directory,
    "opencode2",
    `
const command = Bun.argv.slice(2).join(" ")
if (process.env.OPENCODE_SERVICE_MARKER) {
  const marker = Bun.file(process.env.OPENCODE_SERVICE_MARKER)
  await Bun.write(marker, (await marker.exists() ? await marker.text() : "") + command + "\\n")
}
if (process.env.OPENCODE_TEST_SERVICE === "unavailable") process.exit(1)
if (command === "service status") {
  console.log(process.env.OPENCODE_TEST_SERVICE === "malformed" ? "not a URL" : "http://127.0.0.1:54321")
  process.exit(0)
}
if (command === "service get password") {
  console.log("live-web-secret")
  process.exit(0)
}
process.exit(1)
`,
  )
  return {
    directory,
    browser,
  }
}

async function writeExecutable(directory: string, name: string, source: string) {
  const script = join(directory, `${name}.ts`)
  await Bun.write(script, source)
  if (process.platform === "win32") {
    const executable = join(directory, `${name}.cmd`)
    await Bun.write(executable, `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`)
    return executable
  }

  const executable = join(directory, name)
  await Bun.write(executable, `#!/usr/bin/env bun\n${source}`)
  chmodSync(executable, 0o755)
  return executable
}

async function waitFor(check: () => boolean | Promise<boolean>) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await check()) return
    await Bun.sleep(100)
  }
  throw new Error("Timed out waiting for live web launcher")
}

function readUrl(url: string) {
  return new Promise<string>((resolve, reject) => {
    get(url, (response) => {
      const chunks: Buffer[] = []
      response.on("data", (chunk) => chunks.push(chunk))
      response.on("end", () => resolve(Buffer.concat(chunks).toString()))
      response.on("error", reject)
    }).on("error", reject)
  })
}
