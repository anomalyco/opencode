#!/usr/bin/env bun

import { existsSync } from "node:fs"
import { chmod, mkdir, mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { createOpencode } from "@opencode-ai/sdk/v2"

const serverName = "sdk-disconnect-proof"
const repoRoot = path.resolve(fileURLToPath(new URL("../../../../", import.meta.url)))
const tmp = await mkdtemp(path.join(os.tmpdir(), "opencode-sdk-mcp-"))
const previousPath = process.env.PATH
const previousRepoRoot = process.env.OPENCODE_REPO_ROOT

try {
  const binDir = path.join(tmp, "bin")
  const projectDir = path.join(tmp, "project")
  const lifecyclePath = path.join(tmp, "mcp-lifecycle.jsonl")
  const mcpServerPath = path.join(tmp, "proof-mcp-server.js")

  await mkdir(binDir)
  await mkdir(projectDir)
  await Bun.write(
    path.join(binDir, "opencode"),
    '#!/usr/bin/env sh\nexec bun --conditions=browser "$OPENCODE_REPO_ROOT/packages/opencode/src/index.ts" "$@"\n',
  )
  await chmod(path.join(binDir, "opencode"), 0o755)
  await Bun.write(mcpServerPath, proofMcpServerSource())

  process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH ?? ""}`
  process.env.OPENCODE_REPO_ROOT = repoRoot

  const opencode = await createOpencode({
    port: 0,
    timeout: 30_000,
    config: {
      logLevel: "ERROR",
      formatter: false,
      lsp: false,
    },
  })

  try {
    console.log(`started opencode server: ${opencode.server.url}`)

    const added = await opencode.client.mcp.add(
      {
        directory: projectDir,
        name: serverName,
        config: {
          type: "local",
          command: ["bun", mcpServerPath],
          environment: {
            MCP_LIFECYCLE_LOG: lifecyclePath,
          },
          timeout: 5_000,
        },
      },
      { throwOnError: true },
    )
    requireStatus(added.data[serverName], "connected", "add response")
    console.log(`registered MCP server: ${serverName}`)

    const afterAdd = await opencode.client.mcp.status({ directory: projectDir }, { throwOnError: true })
    requireStatus(afterAdd.data[serverName], "connected", "status after add")
    console.log(`status after add: ${afterAdd.data[serverName]?.status}`)

    const disconnected = await opencode.client.mcp.disconnect(
      {
        directory: projectDir,
        name: serverName,
      },
      { throwOnError: true },
    )
    if (disconnected.data !== true) throw new Error(`Expected disconnect to return true, got ${disconnected.data}`)

    const afterDisconnect = await opencode.client.mcp.status({ directory: projectDir }, { throwOnError: true })
    requireStatus(afterDisconnect.data[serverName], "disabled", "status after disconnect")
    console.log(`status after disconnect: ${afterDisconnect.data[serverName]?.status}`)

    const lifecycle = await waitForLifecycle(lifecyclePath, (events) => events.some((event) => event.event === "exit"))
    const eventNames = lifecycle.map((event) => event.event)
    for (const event of ["started", "request:initialize", "request:tools/list", "stdin-end", "exit"]) {
      if (!eventNames.includes(event))
        throw new Error(`Expected lifecycle event ${event}; saw ${eventNames.join(", ")}`)
    }

    console.log(`MCP lifecycle proof: ${eventNames.join(" -> ")}`)
    console.log("disconnect proof passed")
  } finally {
    opencode.server.close()
  }
} finally {
  if (previousPath === undefined) delete process.env.PATH
  if (previousPath !== undefined) process.env.PATH = previousPath
  if (previousRepoRoot === undefined) delete process.env.OPENCODE_REPO_ROOT
  if (previousRepoRoot !== undefined) process.env.OPENCODE_REPO_ROOT = previousRepoRoot
  await rm(tmp, { recursive: true, force: true })
}

function requireStatus(status: { status: string } | undefined, expected: string, label: string) {
  if (status?.status === expected) return
  throw new Error(`Expected ${label} to be ${expected}, got ${JSON.stringify(status)}`)
}

async function waitForLifecycle(file: string, predicate: (events: Array<{ event: string; pid: number }>) => boolean) {
  const start = Date.now()
  while (Date.now() - start < 5_000) {
    const events = await readLifecycle(file)
    if (predicate(events)) return events
    await Bun.sleep(50)
  }
  throw new Error(`Timed out waiting for MCP lifecycle proof. Saw: ${JSON.stringify(await readLifecycle(file))}`)
}

async function readLifecycle(file: string) {
  if (!existsSync(file)) return []
  return (await readFile(file, "utf8"))
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { event: string; pid: number })
}

function proofMcpServerSource() {
  return String.raw`import fs from "node:fs"

const lifecyclePath = process.env.MCP_LIFECYCLE_LOG
let input = ""
let closing = false

function write(event) {
  if (!lifecyclePath) return
  fs.appendFileSync(lifecyclePath, JSON.stringify({ event, pid: process.pid }) + "\n")
}

function send(message) {
  process.stdout.write(JSON.stringify(message) + "\n")
}

function close(event) {
  if (closing) return
  closing = true
  write(event)
  process.exit(0)
}

function handle(message) {
  write("request:" + (message.method ?? "unknown"))
  if (!("id" in message)) return

  if (message.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: message.params?.protocolVersion ?? "2025-11-25",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "opencode-sdk-disconnect-proof", version: "1.0.0" },
      },
    })
    return
  }

  if (message.method === "tools/list") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        tools: [
          {
            name: "proof_tool",
            description: "A no-op tool used by the SDK MCP disconnect proof.",
            inputSchema: { type: "object", properties: {}, additionalProperties: false },
          },
        ],
      },
    })
    return
  }

  if (message.method === "ping") {
    send({ jsonrpc: "2.0", id: message.id, result: {} })
    return
  }

  send({
    jsonrpc: "2.0",
    id: message.id,
    error: { code: -32601, message: "Method not found" },
  })
}

write("started")
process.stdin.setEncoding("utf8")
process.stdin.on("data", (chunk) => {
  input += chunk
  while (input.includes("\n")) {
    const index = input.indexOf("\n")
    const line = input.slice(0, index).trim()
    input = input.slice(index + 1)
    if (line) handle(JSON.parse(line))
  }
})
process.stdin.on("end", () => close("stdin-end"))
process.stdin.on("close", () => close("stdin-close"))
process.on("SIGTERM", () => close("sigterm"))
process.on("SIGINT", () => close("sigint"))
process.on("exit", () => write("exit"))
`
}
