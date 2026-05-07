#!/usr/bin/env bun
// @ts-nocheck
/**
 * E2E test: verify all three classes of major foundation models on Databricks
 * Model Serving can handle a tool call.
 *
 * Usage:
 *   DATABRICKS_CONFIG_PROFILE=logfood bun run script/test-databricks-3-classes.ts
 *   bun run script/test-databricks-3-classes.ts --profile logfood
 */
import { generateText, tool, jsonSchema } from "ai"

const profile = process.argv.includes("--profile")
  ? process.argv[process.argv.indexOf("--profile") + 1]
  : process.env["DATABRICKS_CONFIG_PROFILE"]

const TARGETS: Array<{ class: string; match: (n: string) => boolean; forceResponses?: boolean }> = [
  { class: "Claude (Anthropic)", match: (n: string) => n === "databricks-claude-sonnet-4-6" },
  // GPT-5.x on Databricks requires Responses API for tool use even though the
  // serving-endpoint metadata reports task=llm/v1/chat. The proxy returns 400
  // on /v1/chat/completions: "Function tools with reasoning_effort are not
  // supported for gpt-5.5 in /v1/chat/completions. Please use /v1/responses".
  { class: "GPT (OpenAI)",       match: (n: string) => n === "databricks-gpt-5-5", forceResponses: true },
  { class: "Gemini (Google)",    match: (n: string) => n === "databricks-gemini-2-5-pro" },
]

console.log(`=== Databricks 3-class E2E (profile: ${profile ?? "env"}) ===\n`)

const { Config: DatabricksConfig, WorkspaceClient } = await import("@databricks/sdk-experimental")

const env = { ...process.env }
if (profile) {
  delete env.DATABRICKS_HOST
  delete env.DATABRICKS_TOKEN
}

const dbConfig = new DatabricksConfig({ env, profile })
await dbConfig.ensureResolved()
const host = (await dbConfig.getHost()).origin
console.log(`Host: ${host}\n`)

const ws = new WorkspaceClient(dbConfig)
const endpoints = []
for await (const ep of ws.servingEndpoints.list()) {
  if (ep.state?.ready === "READY") endpoints.push(ep)
}

const { createOpenAI } = await import("@ai-sdk/openai")

const databricksFetch: typeof globalThis.fetch = async (url, init) => {
  const h = new Headers(init?.headers)
  await dbConfig.authenticate(h)
  if (init?.body && typeof init.body === "string") {
    try {
      const body = JSON.parse(init.body)
      if (Array.isArray(body.tools)) {
        for (const t of body.tools) {
          const params = t.function?.parameters
          if (params && !params.type) params.type = "object"
        }
        init = { ...init, body: JSON.stringify(body) }
      }
    } catch {}
  }
  return fetch(url, { ...init, headers: h })
}

const provider = createOpenAI({
  baseURL: `${host}/serving-endpoints`,
  apiKey: "databricks",
  fetch: databricksFetch,
})

type Result = { class: string; model: string; pass: boolean; reason?: string; toolArgs?: unknown }
const results: Result[] = []

for (const target of TARGETS) {
  const ep = endpoints.find((e) => target.match(e.name ?? ""))
  if (!ep) {
    console.log(`[${target.class}] SKIP — no matching endpoint on this workspace`)
    results.push({ class: target.class, model: "(none)", pass: false, reason: "endpoint not found" })
    continue
  }

  console.log(`[${target.class}] Testing: ${ep.name} (${ep.task})`)

  const isResponses = ep.task === "llm/v1/responses" || target.forceResponses
  const model = isResponses ? provider.responses(ep.name!) : provider.chat(ep.name!)

  const callPromise = generateText({
    model,
    maxTokens: 300,
    tools: {
      get_weather: tool({
        description: "Get the current weather for a location",
        inputSchema: jsonSchema<{ location: string }>({
          type: "object",
          properties: { location: { type: "string", description: "City name" } },
          required: ["location"],
          additionalProperties: false,
        }),
        execute: async ({ location }: { location: string }) => {
          console.log(`  [tool] get_weather({ location: "${location}" })`)
          return { temperature: 22, condition: "sunny", location }
        },
      }),
    },
    maxSteps: 3,
    messages: [{ role: "user", content: "What is the weather in Melbourne? Use the get_weather tool." }],
  })

  let res: Awaited<typeof callPromise> | null = null
  let err: Error | null = null
  try {
    res = await callPromise
  } catch (e) {
    err = e as Error
  }

  if (err) {
    console.log(`  FAIL — ${err.message?.slice(0, 200)}\n`)
    results.push({ class: target.class, model: ep.name!, pass: false, reason: err.message?.slice(0, 200) })
    continue
  }

  const toolCalls = res!.steps.flatMap((s) => s.toolCalls)
  const toolResults = res!.steps.flatMap((s) => s.toolResults)
  const toolArgs = (toolCalls[0] as any)?.input
  const pass = toolCalls.length > 0 && toolResults.length > 0 && !!toolArgs?.location

  console.log(`  steps=${res!.steps.length}  tool_calls=${toolCalls.length}  tool_results=${toolResults.length}  finish=${res!.finishReason}`)
  if (toolArgs) console.log(`  args: ${JSON.stringify(toolArgs)}`)
  if (res!.text) console.log(`  text: ${res!.text.slice(0, 120)}`)
  console.log(`  ${pass ? "PASS" : "FAIL"}\n`)

  results.push({
    class: target.class,
    model: ep.name!,
    pass,
    toolArgs,
    reason: pass ? undefined : `tool_calls=${toolCalls.length} tool_results=${toolResults.length} args=${toolArgs ? "yes" : "no"}`,
  })
}

console.log("=== Summary ===")
for (const r of results) {
  console.log(`  ${r.pass ? "PASS" : "FAIL"}  ${r.class.padEnd(20)}  ${r.model}${r.reason ? "  — " + r.reason : ""}`)
}

const allPass = results.every((r) => r.pass)
process.exit(allPass ? 0 : 1)
