import { expect, test } from "bun:test"
import { Schema } from "effect"
import path from "node:path"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { tmpdir } from "../fixture/fixture"
import { withTimeout } from "../../src/util/timeout"
import { SessionAdvisor } from "../../src/session/advisor"

const Ready = Schema.Struct({ url: Schema.String, directory: Schema.String, state: Schema.String })
type Ready = typeof Ready.Type
const Session = Schema.Struct({ id: Schema.String, cost: Schema.optional(Schema.Number) })

function spawn(directory: string) {
  return Bun.spawn(
    [
      process.execPath,
      path.resolve(import.meta.dir, "../fixture/advisor-server.ts"),
      "--port",
      "0",
      "--directory",
      directory,
      "--scenario",
      "pause",
    ],
    {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env },
    },
  )
}

async function ready(child: ReturnType<typeof spawn>) {
  const reader = child.stdout.getReader()
  const decoder = new TextDecoder()
  let pending = ""
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) throw new Error("Advisor test server exited before readiness")
      pending += decoder.decode(chunk.value, { stream: true })
      let end = pending.indexOf("\n")
      while (end >= 0) {
        const line = pending.slice(0, end)
        pending = pending.slice(end + 1)
        if (line.startsWith('{"url":')) return Schema.decodeUnknownSync(Ready)(JSON.parse(line))
        end = pending.indexOf("\n")
      }
    }
  } finally {
    reader.releaseLock()
  }
}

async function stop(child: ReturnType<typeof spawn>) {
  if (child.exitCode !== null) return
  child.kill("SIGTERM")
  try {
    await withTimeout(child.exited, 5000, "Advisor fixture did not stop")
  } finally {
    if (child.exitCode === null) child.kill("SIGKILL")
    await child.exited
  }
}

async function request(server: Ready, resource: string, body?: unknown) {
  const url = new URL(resource, server.url)
  url.searchParams.set("directory", server.directory)
  const response = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  })
  if (!response.ok) throw new Error(`Advisor API ${response.status}: ${await response.text()}`)
  return response.status === 204 ? undefined : response.json()
}

async function complete(server: Ready, sessionID: string, after = 0) {
  const deadline = Date.now() + 20000
  while (Date.now() < deadline) {
    const messages = Schema.decodeUnknownSync(Schema.Array(SessionV1.WithParts))(
      await request(server, `/session/${sessionID}/message`),
    )
    const assistants = messages.filter((message) => message.info.role === "assistant")
    const latest = assistants.at(-1)
    if (latest?.info.role === "assistant" && latest.info.error) throw new Error(JSON.stringify(latest.info.error))
    if (
      assistants.length > after &&
      latest?.info.role === "assistant" &&
      latest.info.time.completed &&
      latest.info.finish === "stop" &&
      latest.parts.some((part) => part.type === "text" && part.text === "Fixture complete.")
    )
      return messages
    await Bun.sleep(25)
  }
  throw new Error("Advisor session did not reach a completed provider response")
}

// A child process makes restart exercise durable history rather than cached SDK/service state.
test("V1 prompt_async preserves advisor results, cost, and disabled-history replay across restart", async () => {
  await using directory = await tmpdir()
  const project = path.join(directory.path, "project")
  let child = spawn(project)
  let errors = new Response(child.stderr).text()
  try {
    let server = await withTimeout(ready(child), 15000, "Advisor test server did not start")
    const session = Schema.decodeUnknownSync(Session)(await request(server, "/session", {}))
    const prompt = {
      agent: "build",
      model: { providerID: "anthropic", modelID: "claude-sonnet-4-6" },
      parts: [{ type: "text", text: "Inspect the fixture" }],
    }
    await request(server, `/session/${session.id}/prompt_async`, prompt)
    const messages = await complete(server, session.id)
    const advisors = messages
      .flatMap((message) => message.parts)
      .filter((part) => part.type === "tool" && part.tool === "advisor")
    expect(advisors).toHaveLength(1)
    expect(advisors[0]).toMatchObject({ state: { status: "completed" } })
    expect(
      messages.flatMap((message) => message.parts).find((part) => part.type === "tool" && part.tool === "read"),
    ).toMatchObject({
      state: { status: "completed", input: { filePath: "pool.ts" }, output: expect.stringContaining("limit") },
    })
    const steps = messages.flatMap((message) => message.parts).filter((part) => part.type === "step-finish")
    const billed = steps.map((part) => SessionAdvisor.response(part)?.usage).filter(Boolean)
    expect(billed).toMatchObject([{ complete: true, cost: 0.01 }])
    const before = Schema.decodeUnknownSync(Session)(await request(server, `/session/${session.id}`))
    expect(before.cost).toBeCloseTo(
      steps.reduce((sum, step) => sum + step.cost, 0),
      12,
    )

    await stop(child)
    await errors
    const configFile = Bun.file(path.join(server.directory, "opencode.json"))
    const config = await configFile.json()
    config.agent.build.advisor = false
    await Bun.write(configFile, JSON.stringify(config))
    child = spawn(project)
    errors = new Response(child.stderr).text()
    server = await withTimeout(ready(child), 15000, "Advisor test server did not restart")
    expect(Schema.decodeUnknownSync(Session)(await request(server, `/session/${session.id}`)).cost).toBe(before.cost)
    await request(server, `/session/${session.id}/prompt_async`, prompt)
    const followup = await complete(
      server,
      session.id,
      messages.filter((message) => message.info.role === "assistant").length,
    )
    expect(
      followup.flatMap((message) => message.parts).filter((part) => part.type === "tool" && part.tool === "advisor"),
    ).toHaveLength(1)
    expect(await Bun.file(path.join(server.state, "requests.jsonl")).text()).toContain(
      '"advertised":false,"completed":true',
    )
  } catch (error) {
    await stop(child)
    throw new Error(`${String(error)}\n${await errors}`)
  } finally {
    await stop(child)
  }
}, 60000)
