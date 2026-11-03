#!/usr/bin/env bun

import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"
import { Schema } from "effect"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { isolatedEnv } from "../test/fixture/environment"
import { toolCallStream } from "../test/acp/subprocess"
import { OpenCode } from "@opencode/client/promise"

// Exercise the published executable through its real provider/tool/permission path.
// Only the model responses are scripted. No production hook or plugin is installed.
const source = process.argv[2] && path.resolve(process.argv[2])
if (!source || process.platform !== "darwin")
  throw new Error("Usage on macOS: bun run script/sandbox-smoke.ts <compiled-opencode>")
const probe = Bun.spawnSync(["/usr/bin/sandbox-exec", "-p", "(version 1)(allow default)", "/usr/bin/true"])
assert.equal(probe.exitCode, 0, "Run outside any enclosing sandbox so Seatbelt tests cannot skip")

await using temporary = await tmpdir("opencode-artifact-sandbox-")
const binary = path.join(temporary.path, "opencode")
await fs.copyFile(source, binary)
await fs.chmod(binary, 0o755)
const installedRipgrep = process.env.OPENCODE_TEST_RIPGREP ?? Bun.which("rg")
assert(installedRipgrep, "An installed standalone ripgrep is required to seed the isolated managed cache")
const rg = installedRipgrep

type Call = { name: string; input: Record<string, unknown>; expect?: string }
const Body = Schema.Struct({
  messages: Schema.Array(Schema.Struct({ role: Schema.String, content: Schema.optional(Schema.Unknown) })),
  tools: Schema.optional(Schema.Array(Schema.Struct({ function: Schema.Struct({ name: Schema.String }) }))),
})
let active: { calls: Call[]; next: number; failure?: Error } = { calls: [], next: 0 }
using provider = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    if (new URL(request.url).pathname === "/probe") return new Response("reachable")
    try {
      const body = Schema.decodeUnknownSync(Body)(await request.json())
      if (body.tools?.length) {
        const previous = active.calls[active.next - 1]
        if (previous?.expect) {
          const result = body.messages.findLast((message) => message.role === "tool")
          assert(
            result && JSON.stringify(result.content).toLowerCase().includes(previous.expect.toLowerCase()),
            `Missing result ${previous.expect}: ${JSON.stringify(result)}`,
          )
        }
        const call = active.calls[active.next]
        if (call) {
          assert(
            body.tools.some((tool) => tool.function.name === call.name),
            `Tool ${call.name} is not advertised`,
          )
          active.next++
          return toolCallStream(`smoke_${active.next}`, call.name, call.input)
        }
      }
      return new Response(
        `data: ${JSON.stringify({ choices: [{ delta: { role: "assistant", content: "ARTIFACT_SMOKE_COMPLETE" }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
        { headers: { "content-type": "text/event-stream" } },
      )
    } catch (cause) {
      active.failure = cause instanceof Error ? cause : new Error(String(cause))
      return new Response(active.failure.message, { status: 500 })
    }
  },
})
assert.equal(await (await fetch(new URL("/probe", provider.url))).text(), "reachable")

async function fixture(name: string, enabled = true, fullDiskRead = false) {
  const root = path.join(temporary.path, name)
  const directory = path.join(root, "workspace")
  const outside = path.join(root, "outside")
  const reference = path.join(root, "reference")
  const data = path.join(root, "data", "opencode")
  const config = path.join(root, "config")
  const cache = path.join(root, "cache", "opencode", "bin")
  await Promise.all(
    [directory, outside, reference, data, config, cache, path.join(root, "tmp")].map((folder) =>
      fs.mkdir(folder, { recursive: true }),
    ),
  )
  await fs.copyFile(rg, path.join(cache, "rg"))
  await fs.chmod(path.join(cache, "rg"), 0o500)
  await fs.mkdir(path.join(root, ".ssh"))
  await fs.writeFile(path.join(root, ".ssh", "canary"), "PRIVATE_CREDENTIAL_CANARY")
  await fs.writeFile(path.join(outside, "public"), "OUTSIDE_READ_CANARY")
  await fs.writeFile(path.join(reference, "readme"), "REFERENCE_READ_CANARY")
  await fs.mkdir(path.join(data, "repos"))
  await fs.writeFile(path.join(data, "repos", "readme"), "DATA_REFERENCE_CANARY")
  await fs.writeFile(path.join(data, "opencode-probe.db"), "PRIVATE_DATABASE_CANARY")
  await fs.writeFile(path.join(root, "models.json"), "{}")
  await fs.writeFile(path.join(root, "git-system"), "[core]\n  abbrev = 8\n")
  await fs.writeFile(path.join(root, "git-global"), "[user]\n  name = Smoke Test\n")
  await fs.writeFile(
    path.join(config, "opencode.json"),
    JSON.stringify({
      update: "disable",
      experimental: { sandbox: { enabled, full_disk_read: fullDiskRead, readable_roots: [binary] } },
      model: "smoke/test-model",
      references: {
        external: { path: reference, description: "Reference smoke test" },
        data: { path: data, description: "Data reference smoke test" },
      },
      snapshots: true,
      permissions: [
        { action: "*", resource: "*", effect: "ask" },
        { action: "shell", resource: "touch *", effect: "deny" },
      ],
      formatter: {
        smoke: {
          extensions: [".fmt"],
          command: [
            "/bin/sh",
            "-c",
            `printf forbidden > '${outside}/formatter-escape'; printf formatted > "$1"`,
            "--",
            "$FILE",
          ],
        },
      },
      providers: {
        smoke: {
          name: "Artifact smoke",
          package: "aisdk:@ai-sdk/openai-compatible",
          settings: { apiKey: "test-key", baseURL: new URL("/v1", provider.url).href },
          models: Object.fromEntries(
            ["test-model", "gpt-smoke"].map((id) => [
              id,
              {
                name: id,
                capabilities: { tools: true, input: ["text"], output: ["text"] },
                cost: { input: 0, output: 0 },
                limit: { context: 100000, output: 10000 },
              },
            ]),
          ),
        },
      },
    }),
  )
  const env = isolatedEnv(root, {
    OPENCODE_CONFIG_CONTENT: undefined,
    OPENCODE_CONFIG: undefined,
    OPENCODE_MODELS_PATH: path.join(root, "models.json"),
    OPENCODE_DISABLE_CLAUDE_CODE: "1",
    OPENCODE_DISABLE_PROJECT_CONFIG: "1",
    OPENCODE_DISABLE_AUTOUPDATE: "1",
    OPENCODE_DRIVE: undefined,
    OPENCODE_SIMULATE: undefined,
    SMOKE_SECRET_TOKEN: "PRIVATE_ENVIRONMENT_CANARY",
    PWD: directory,
    TMPDIR: path.join(root, "tmp"),
    GIT_CONFIG_SYSTEM: path.join(root, "git-system"),
    GIT_CONFIG_GLOBAL: path.join(root, "git-global"),
  })
  return { root, directory, outside, reference, data, config, env }
}

async function execute(f: Awaited<ReturnType<typeof fixture>>, args: string[]) {
  const child = Bun.spawn([binary, ...args], {
    cwd: f.directory,
    env: f.env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  const timer = setTimeout(() => child.kill("SIGKILL"), 60000)
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]).finally(() => clearTimeout(timer))
  if (active.failure) throw active.failure
  assert.equal(code, 0, `Compiled command failed: ${stderr.slice(-8000)}\n${stdout.slice(-4000)}`)
  return { stdout, stderr }
}

async function run(f: Awaited<ReturnType<typeof fixture>>, calls: Call[], extra: string[] = []) {
  active = { calls, next: 0 }
  const result = await execute(f, [
    "run",
    "--standalone",
    "--format",
    "json",
    "--title",
    "Sandbox artifact smoke",
    ...extra,
    "Exercise the scripted sandbox checks.",
  ])
  assert.equal(active.next, calls.length, `Not all planned tools ran: ${result.stderr}\n${result.stdout}`)
  return result
}

for (const fullDiskRead of [false, true]) {
  const f = await fixture(fullDiskRead ? "broad" : "strict", true, fullDiskRead)
  active = { calls: [], next: 0 }
  const status = Schema.decodeUnknownSync(
    Schema.fromJsonString(Schema.Struct({ active: Schema.Boolean, reads: Schema.String })),
  )((await execute(f, ["debug", "sandbox", "--standalone"])).stdout)
  assert.equal(status.active, true)
  assert.equal(status.reads, fullDiskRead ? "broad" : "restricted")
  const network = `BUN_BE_BUN=1 '${binary}' --config=/dev/null --no-env-file --no-addons --no-macros --eval 'fetch(${JSON.stringify(new URL("/probe", provider.url).href)}).then(() => { console.log("NETWORK_UNEXPECTED"); process.exitCode=1 }, () => console.log("NETWORK_BLOCKED"))'`
  await run(f, [
    { name: "shell", input: { command: 'test -z "$SMOKE_SECRET_TOKEN" && printf SHELL_OK' }, expect: "SHELL_OK" },
    {
      name: "shell",
      input: { command: 'count=$(sysctl -n hw.ncpu) && test "$count" -gt 0 && printf SYSCTL_WORKS' },
      expect: "SYSCTL_WORKS",
    },
    { name: "write", input: { path: "sample.txt", content: "NATIVE_WRITE_CANARY\n" } },
    { name: "read", input: { path: "sample.txt" }, expect: "NATIVE_WRITE_CANARY" },
    { name: "edit", input: { path: "sample.txt", oldString: "NATIVE_WRITE_CANARY", newString: "NATIVE_EDIT_CANARY" } },
    { name: "glob", input: { pattern: "*.txt" }, expect: "sample.txt" },
    { name: "grep", input: { pattern: "NATIVE_EDIT_CANARY" }, expect: "NATIVE_EDIT_CANARY" },
    { name: "write", input: { path: "format.fmt", content: "unformatted" } },
    { name: "shell", input: { command: network }, expect: "NETWORK_BLOCKED" },
    {
      name: "shell",
      input: { command: "git config --get core.abbrev && printf GIT_CONFIG_OK" },
      expect: "GIT_CONFIG_OK",
    },
    { name: "shell", input: { command: `cat '${f.reference}/readme'` }, expect: "REFERENCE_READ_CANARY" },
    { name: "shell", input: { command: `cat '${f.data}/repos/readme'` }, expect: "DATA_REFERENCE_CANARY" },
    { name: "shell", input: { command: `cat '${f.data}/opencode-probe.db'` }, expect: "Operation not permitted" },
    {
      name: "shell",
      input: { command: `cat '${f.outside}/public'` },
      expect: fullDiskRead ? "OUTSIDE_READ_CANARY" : "Operation not permitted",
    },
    { name: "shell", input: { command: `cat '${f.root}/.ssh/canary'` }, expect: "Operation not permitted" },
    {
      name: "shell",
      input: { command: `printf forbidden > '${f.outside}/shell-escape'` },
      expect: "Operation not permitted",
    },
    { name: "write", input: { path: path.join(f.outside, "native-escape"), content: "forbidden" } },
    { name: "write", input: { path: ".opencode/plugin.js", content: "forbidden" } },
  ])
  assert.equal(await fs.readFile(path.join(f.directory, "sample.txt"), "utf8"), "NATIVE_EDIT_CANARY\n")
  assert.equal(await fs.readFile(path.join(f.directory, "format.fmt"), "utf8"), "formatted")
  for (const file of ["shell-escape", "native-escape", "formatter-escape"])
    assert.equal(await Bun.file(path.join(f.outside, file)).exists(), false)
  assert.equal(await Bun.file(path.join(f.directory, ".opencode/plugin.js")).exists(), false)
  await run(
    f,
    [
      {
        name: "patch",
        input: { patchText: "*** Begin Patch\n*** Add File: patched.txt\n+NATIVE_PATCH_CANARY\n*** End Patch" },
      },
    ],
    ["--model", "smoke/gpt-smoke"],
  )
  assert.equal(await fs.readFile(path.join(f.directory, "patched.txt"), "utf8"), "NATIVE_PATCH_CANARY\n")
  await run(f, [{ name: "shell", input: { command: "touch explicit-deny" } }])
  assert.equal(await Bun.file(path.join(f.directory, "explicit-deny")).exists(), false)
  await run(
    f,
    [
      {
        name: "shell",
        input: {
          command: `printf forbidden > '${f.outside}/headless-escape'`,
          sandbox_permissions: "require_escalated",
          justification: "Artifact test approval must be rejected headlessly",
        },
      },
    ],
    ["--auto"],
  )
  assert.equal(await Bun.file(path.join(f.outside, "headless-escape")).exists(), false)
  console.log(
    `PASS: packaged ${fullDiskRead ? "broad" : "strict"} reads, native tools, formatter, protected writes, network, explicit deny and headless escalation`,
  )
}

const disabled = await fixture("disabled", false)
active = { calls: [], next: 0 }
const status = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ active: Schema.Boolean })))(
  (await execute(disabled, ["debug", "sandbox", "--standalone"])).stdout,
)
assert.equal(status.active, false)
await run(
  disabled,
  [{ name: "shell", input: { command: `printf STOCK_HOST_ACCESS > '${disabled.outside}/stock'` } }],
  ["--auto"],
)
assert.equal(await fs.readFile(path.join(disabled.outside, "stock"), "utf8"), "STOCK_HOST_ACCESS")
console.log("PASS: packaged disabled mode retains approved host execution")

const sessionFixture = await fixture("session-prefix")
let primarySession: string | undefined
for (const restarted of [false, true]) {
  const password = "isolated-artifact-prefix-check"
  const server = Bun.spawn([binary, "serve", "--stdio", "--port", "0"], {
    cwd: sessionFixture.directory,
    env: { ...sessionFixture.env, OPENCODE_PASSWORD: password },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  })
  let stderr = ""
  const errors = (async () => {
    for await (const chunk of server.stderr) stderr = (stderr + new TextDecoder().decode(chunk)).slice(-16000)
  })()
  const timer = setTimeout(() => server.kill("SIGKILL"), 60000)
  try {
    const reader = server.stdout.getReader()
    let line = ""
    while (!line.includes("\n")) {
      const chunk = await reader.read()
      assert(!chunk.done, `Server exited before readiness: ${stderr}`)
      line += new TextDecoder().decode(chunk.value)
      assert(line.length < 16000)
    }
    reader.releaseLock()
    const ready = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ url: Schema.String })))(
      line.split("\n")[0],
    )
    const client = OpenCode.make({
      baseUrl: ready.url,
      headers: { authorization: `Basic ${btoa(`opencode:${password}`)}` },
    })
    async function exercise(sessionID: string, calls: Call[], decision?: "session" | "reject") {
      active = { calls, next: 0 }
      const controller = new AbortController()
      const stream = client.event.subscribe({ signal: controller.signal })[Symbol.asyncIterator]()
      assert(!(await stream.next()).done)
      let asked = 0
      try {
        await client.session.prompt({ sessionID, text: "Exercise the scripted session prefix checks." })
        while (true) {
          const next = await stream.next()
          assert(!next.done, "Event stream ended before execution completed")
          const event = next.value
          if (event.type === "permission.asked" && event.data.sessionID === sessionID) {
            asked++
            assert(decision, "A matching session grant must not prompt again")
            assert.equal(event.data.action, "sandbox.exec")
            if (decision === "session") {
              assert.deepEqual(event.data.save, ["/usr/bin/touch"])
              for (const body of [
                { decision: "always", experimental: { acknowledgeSandbox: true } },
                { decision: "always", experimental: { saveSandboxPrefix: true } },
              ]) {
                const response: Response = await fetch(
                  new URL(`/api/session/${sessionID}/permission/${event.data.id}/reply`, ready.url),
                  {
                    method: "POST",
                    headers: {
                      authorization: `Basic ${btoa(`opencode:${password}`)}`,
                      "content-type": "application/json",
                    },
                    body: JSON.stringify(body),
                  },
                )
                assert.equal(response.status, 409, "Incomplete session-scope consent must leave the request pending")
              }
            }
            await client.permission.reply({
              sessionID,
              requestID: event.data.id,
              decision: decision === "session" ? "always" : "reject",
              ...(decision === "session"
                ? { experimental: { acknowledgeSandbox: true, saveSandboxPrefix: true } }
                : {}),
            })
          }
          if (
            (event.type === "session.execution.succeeded" || event.type === "session.execution.interrupted") &&
            event.data.sessionID === sessionID
          )
            break
          if (event.type === "session.execution.failed" && event.data.sessionID === sessionID)
            throw new Error(JSON.stringify(event.data))
        }
        if (active.failure) throw active.failure
        assert.equal(active.next, calls.length)
        assert.equal(asked, decision ? 1 : 0)
      } finally {
        controller.abort()
        await stream.return?.()
      }
    }
    primarySession ??= (
      await client.session.create({
        title: "Artifact session prefix",
        location: { directory: sessionFixture.directory },
      })
    ).id
    const command = (name: string, escalated = true): Call => ({
      name: "shell",
      input: {
        command: `/usr/bin/touch ${sessionFixture.outside}/${name}`,
        ...(escalated
          ? { sandbox_permissions: "require_escalated", justification: "Exercise the reviewed session prefix" }
          : {}),
      },
    })
    if (restarted) {
      await exercise(primarySession, [command("restart-rejected")], "reject")
      assert.equal(await Bun.file(path.join(sessionFixture.outside, "restart-rejected")).exists(), false)
      continue
    }
    await exercise(primarySession, [command("prefix-first"), command("prefix-second")], "session")
    for (const name of ["prefix-first", "prefix-second"])
      assert(await Bun.file(path.join(sessionFixture.outside, name)).exists())
    await exercise(primarySession, [command("default-stays-confined", false)])
    assert.equal(await Bun.file(path.join(sessionFixture.outside, "default-stays-confined")).exists(), false)
    const other = await client.session.create({
      title: "Other session must ask",
      location: { directory: sessionFixture.directory },
    })
    await exercise(other.id, [command("other-rejected")], "reject")
    assert.equal(await Bun.file(path.join(sessionFixture.outside, "other-rejected")).exists(), false)
  } finally {
    await server.stdin.end()
    await server.exited
    await errors
    clearTimeout(timer)
  }
}
console.log("PASS: packaged session prefix approval/reuse, separate sessions, default confinement and restart expiry")
console.log("Artifact sandbox smoke passed with only the executable copied; all fixture config/data was isolated.")
