import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { createOpencode } from "@opencode-ai/sdk"

const file = Bun.file(path.join(os.homedir(), ".env.d", "codex.env"))
const ok = await file.exists()
if (!ok) {
  console.error("Missing ~/.env.d/codex.env for Azure evaluation credentials.")
  process.exit(1)
}

const text = await file.text()
text.split(/\r?\n/).forEach((raw) => {
  const line = raw.trim()
  if (!line) return
  if (line.startsWith("#")) return
  const index = line.indexOf("=")
  if (index <= 0) return
  const key = line.slice(0, index).trim()
  if (!key) return
  const value = line.slice(index + 1).trim()
  process.env[key] = value
})

const base = process.env.AZURE_OPENAI_BASE_URL
if (base) {
  const url = new URL(base)
  const host = `${url.protocol}//${url.host}`
  if (!process.env.AZURE_API_BASE_URL) process.env.AZURE_API_BASE_URL = host
  if (!process.env.AZURE_OPENAI_API_BASE_URL) process.env.AZURE_OPENAI_API_BASE_URL = host
}

if (process.env.AZURE_OPENAI_API_KEY && !process.env.AZURE_API_KEY) {
  process.env.AZURE_API_KEY = process.env.AZURE_OPENAI_API_KEY
}

const model = process.env.AZURE_EVAL_MODEL || process.env.AZURE_OPENAI_DEPLOYMENT_NAME || "gpt-5.2-codex"
const version = process.env.AZURE_OPENAI_API_VERSION || process.env.AZURE_API_VERSION || "preview"
if (!process.env.AZURE_API_VERSION) process.env.AZURE_API_VERSION = version
if (!process.env.AZURE_OPENAI_API_VERSION) process.env.AZURE_OPENAI_API_VERSION = version

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-eval-"))

const prompt = `You are working in the current directory.\n\n1) Create hello.py that prints exactly: Hello, world!\n2) Create test_hello.py using Python's unittest. It must run hello.py, capture stdout, and assert the output equals \"Hello, world!\" plus a trailing newline.\n3) Run: python -m unittest -q\n4) In your final response, include the test command output and a brief confirmation.`

const tools = {
  bash: true,
  edit: true,
  write: true,
  read: true,
  list: true,
  glob: true,
  grep: true,
}

const { client, server } = await createOpencode()

type ProviderInfo = {
  id: string
  models?: Record<string, { variants?: Record<string, Record<string, unknown>> }>
}

const list = await client.provider.list()
const all = (list?.data?.all ?? list?.all ?? []) as ProviderInfo[]
const azure = all.find((item) => item.id === "azure")
if (!azure) {
  console.error("Azure provider not found in opencode provider list.")
  server.close()
  process.exit(1)
}

const info = azure.models?.[model]
if (!info) {
  console.error(`Azure model not found: ${model}`)
  server.close()
  process.exit(1)
}

const variants = info.variants ? Object.keys(info.variants) : []
if (!variants.includes("xhigh")) {
  console.error(`Azure model ${model} does not expose xhigh reasoning effort.`)
  server.close()
  process.exit(1)
}

type IdResult = { data?: { id?: string }; id?: string }
const created = (await client.session.create({ body: { title: `azure-xhigh-${Date.now()}` } })) as IdResult
const sessionId = created.data?.id ?? created.id
if (!sessionId) {
  console.error("Failed to create session.")
  server.close()
  process.exit(1)
}

const url = new URL(`/session/${sessionId}/message`, server.url)
url.searchParams.set("directory", dir)

const body = {
  model: {
    providerID: "azure",
    modelID: model,
  },
  variant: "xhigh",
  tools,
  parts: [
    {
      type: "text",
      text: prompt,
    },
  ],
}

const res = await fetch(url, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
})

if (!res.ok) {
  const msg = await res.text()
  console.error(`Prompt failed: ${res.status} ${res.statusText}\n${msg}`)
  server.close()
  process.exit(1)
}

type PromptResponse = {
  info?: { variant?: string; error?: unknown; tokens?: { reasoning?: number } }
  parts?: Array<{ type?: string; text?: string }>
}

const data = (await res.json()) as PromptResponse
if (!data.info) {
  console.error("Prompt response missing info.")
  server.close()
  process.exit(1)
}

if (data.info.error) {
  console.error(`Prompt returned error: ${JSON.stringify(data.info.error)}`)
  server.close()
  process.exit(1)
}

if (data.info.variant !== "xhigh") {
  console.error(`Expected variant xhigh, got: ${data.info.variant ?? "missing"}`)
  server.close()
  process.exit(1)
}

const parts = data.parts ?? []
const reasoning = parts.filter((part) => part.type === "reasoning")
const reasoningTokens = data.info.tokens?.reasoning ?? 0
if (reasoning.length === 0 && reasoningTokens <= 0) {
  console.error("No reasoning parts or reasoning tokens returned for xhigh request.")
  server.close()
  process.exit(1)
}

const run = spawnSync("python", ["-m", "unittest", "-q"], { cwd: dir, encoding: "utf8" })
if (run.error) {
  console.error(String(run.error))
  server.close()
  process.exit(1)
}

const out = (run.stdout ?? "") + (run.stderr ?? "")
if (run.status !== 0) {
  console.error(out.trim() || `unittest failed with status ${run.status}`)
  server.close()
  process.exit(1)
}

console.log(out.trim() || "unittest passed")
console.log("Eval passed: azure gpt-5.2-codex xhigh reasoning works.")
server.close()
process.exit(0)
