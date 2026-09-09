import { expect } from "bun:test"
import { Effect } from "effect"
import { fileURLToPath } from "node:url"
import { testEffect } from "../lib/effect"
import { TestInstance } from "../fixture/fixture"
import { httpApiLayer, requestInDirectory } from "./httpapi-layer"

const fixture = fileURLToPath(new URL("../fixture/dsh-acp.ts", import.meta.url))
const options = { config: {
  backend: {
    type: "dsh" as const,
    command: [process.execPath, fixture, "early-config"],
    models: [
      { key: "deepseek-official/deepseek-v4-flash", name: "DeepSeek V4 Flash" },
      { key: "deepseek-official/deepseek-v4-pro", name: "DeepSeek V4 Pro" },
    ],
    default_model: "deepseek-official/deepseek-v4-flash",
    shutdown_timeout: 500,
  },
  formatter: false as const, lsp: false as const,
} }
const it = testEffect(httpApiLayer)

it.instance("exposes only DSH display metadata to both existing model lists", () => Effect.gen(function* () {
  const { directory } = yield* TestInstance
  const providers = yield* requestInDirectory("/provider", directory)
  expect(yield* providers.json).toMatchObject({
    all: [{ id: "dsh", models: { "deepseek-official/deepseek-v4-pro": { name: "DeepSeek V4 Pro" } } }],
    default: { dsh: "deepseek-official/deepseek-v4-flash" },
    connected: ["dsh"],
  })
  const config = yield* requestInDirectory("/config/providers", directory)
  expect(yield* config.json).toMatchObject({
    providers: [{ id: "dsh", models: { "deepseek-official/deepseek-v4-flash": { name: "DeepSeek V4 Flash" } } }],
    default: { dsh: "deepseek-official/deepseek-v4-flash" },
  })
}), options, 30000)

it.instance("routes prompts through DSH and refuses native transcript mutations", () => Effect.gen(function* () {
  const { directory } = yield* TestInstance
  const created = yield* requestInDirectory("/session", directory, {
    method: "POST", headers: { "content-type": "application/json" }, body: "{}",
  })
  const session = yield* created.json
  if (!session || typeof session !== "object" || !("id" in session) || typeof session.id !== "string") throw new Error("missing session ID")
  const send = (path: string, body: unknown) => requestInDirectory(`/session/${session.id}${path}`, directory, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  })
  const prompt = yield* send("/message", { parts: [{ type: "text", text: "hello" }] })
  expect(prompt.status).toBe(200)
  expect(yield* prompt.json).toMatchObject({ info: { role: "assistant", providerID: "dsh" }, parts: [{ text: "turn 1: finished" }] })
  for (const [path, body] of [
    ["/fork", {}], ["/revert", { messageID: "msg_missing" }],
    ["/summarize", { providerID: "dsh", modelID: "deepseek-official/deepseek-v4-flash" }],
    ["/message", { agent: "plan", parts: [{ type: "text", text: "unsafe plan mismatch" }] }],
  ] as const) {
    const response = yield* send(path, body)
    expect(response.status).toBe(400)
  }
}), options, 30000)
