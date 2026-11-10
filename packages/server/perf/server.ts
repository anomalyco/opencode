// Strobe's script host IS the server process. Nothing here drives sessions or generates model output.
import { mkdtempSync, mkdirSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { Effect, Exit, Scope } from "effect"
import { HttpServer } from "effect/http"

const home = mkdtempSync(path.join(os.tmpdir(), "opencode-server-bench-"))
const directory = path.join(home, "project")
mkdirSync(directory)
process.on("exit", () => rmSync(home, { recursive: true, force: true }))

// Global roots are resolved at import time. Don't discover credentials, config, or a database from the host.
for (const key of Object.keys(process.env)) {
  if (/^(OPENCODE_|OTEL_|AWS_|AZURE_|GOOGLE_|GIT_)|(_API_KEY|_TOKEN)$/i.test(key)) delete process.env[key]
}
Object.assign(process.env, {
  HOME: home,
  USERPROFILE: home,
  OPENCODE_TEST_HOME: home,
  XDG_CONFIG_HOME: path.join(home, "config"),
  XDG_STATE_HOME: path.join(home, "state"),
  XDG_DATA_HOME: path.join(home, "data"),
  XDG_CACHE_HOME: path.join(home, "cache"),
  TMPDIR: home,
  TEMP: home,
  TMP: home,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: path.join(home, ".gitconfig"),
})

const scope = Effect.runSync(Scope.make())

export async function start(origin: string, messages = false) {
  const { ServerProcess } = await import("../src/process")
  const password = crypto.randomUUID()
  if (messages) {
    process.env.PATH = `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH}`
    await Bun.write(
      path.join(directory, "inventory.ts"),
      [
        "// A real shell tool waiting on work in the project, without busy-looping or contacting a provider.",
        "await Bun.sleep(3100)",
        'console.log((await Bun.file("fixture.md").text()).split("\\n")[0])',
      ].join("\n"),
    )
  }
  await Bun.write(
    path.join(directory, "fixture.md"),
    Array.from(
      { length: 96 },
      (_, i) => `Inventory section ${Math.floor(i / 32)}: bin ${i} contains ${i + 17} green widgets.`,
    ).join("\n"),
  )
  for (const args of [
    ["init", "--quiet"],
    ["add", "fixture.md"],
    [
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "--quiet",
      "-m",
      "Seed inventory",
    ],
  ]) {
    const git = Bun.spawnSync(["git", ...args], { cwd: directory })
    if (git.exitCode !== 0) throw new Error(`Fixture git ${args[0]}: ${git.stderr.toString()}`)
  }
  const server = await Effect.runPromise(
    ServerProcess.start<never, never>({
      app: { name: "cli", channel: "local", version: "local" },
      hostname: "127.0.0.1",
      port: 0,
      password,
      database: { path: path.join(home, "opencode.db") },
      models: { fetch: false },
      config: {
        project: false,
        claude: false,
        content: JSON.stringify({
          model: "fixture/scripted",
          providers: {
            fixture: {
              package: messages ? "@opencode/ai/providers/anthropic" : "@opencode/ai/providers/openai-compatible",
              settings: { baseURL: `${origin}/v1`, apiKey: "fixture" },
              models: {
                scripted: {
                  capabilities: { tools: true },
                  limit: { context: messages ? 1000000 : 128000, output: 8192 },
                },
              },
            },
          },
          policies: [
            { action: "provider.use", resource: "*", effect: "deny" },
            { action: "provider.use", resource: "fixture", effect: "allow" },
          ],
          permissions: (messages ? ["subagent", "read", "shell"] : ["subagent", "read"]).map((action) => ({
            action,
            resource: "*",
            effect: "allow",
          })),
        }),
      },
      // Fail closed, including redirects. The allowed request still takes the real HTTP transport.
      fetch(input, init) {
        const url = new URL(input instanceof Request ? input.url : input)
        if (url.origin !== origin) throw new Error(`Offline benchmark blocked ${url.origin}`)
        return fetch(input, { ...init, redirect: "error" })
      },
    }).pipe(Scope.provide(scope)),
  )
  return { baseUrl: HttpServer.formatAddress(server.address), password, directory }
}

export function stop() {
  return Effect.runPromise(Scope.close(scope, Exit.void))
}

export function mainCpuUs() {
  const usage = process.threadCpuUsage()
  return usage.user + usage.system
}

// Only the opt-in diagnostic run calls these. OS thread CPU excludes Bun's helpers, git and
// time blocked on I/O. Use the actual elapsed interval: a busy event loop can delay the timer.
let finish: () => Promise<{ elapsed: number; cpu: number }[]>
export async function beginSamples(profile?: string) {
  const inspector = profile ? new (await import("node:inspector/promises")).Session() : undefined
  inspector?.connect()
  await inspector?.post("Profiler.enable")
  await inspector?.post("Profiler.setSamplingInterval", { interval: 200 })
  await inspector?.post("Profiler.start")
  const now = () => {
    const usage = process.threadCpuUsage()
    return { elapsed: performance.now(), cpu: (usage.user + usage.system) / 1000 }
  }
  const start = now()
  const samples: { elapsed: number; cpu: number }[] = []
  const sample = () => {
    const current = now()
    samples.push({ elapsed: current.elapsed - start.elapsed, cpu: current.cpu - start.cpu })
  }
  const timer = setInterval(sample, 1000)
  finish = async () => {
    clearInterval(timer)
    sample()
    if (inspector && profile) {
      const result = await inspector.post("Profiler.stop")
      inspector.disconnect()
      await Bun.write(profile, JSON.stringify(result.profile))
    }
    return samples
  }
}

export function endSamples() {
  return finish()
}
