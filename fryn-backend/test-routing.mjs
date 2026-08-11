import { createServer } from "node:http"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawn } from "node:child_process"
import assert from "node:assert/strict"

const upstreamPort = 18991
const backendPort = 18992
const expectedFree = ["cohere/north-mini-code:free", "qwen/qwen3-coder:free", "openrouter/free"]
const expectedPaid = "qwen/qwen3.7-flash"
let lastBody
const seenBodies = []

const upstream = createServer(async (req, res) => {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  lastBody = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")
  seenBodies.push(lastBody)
  const forcePaid = lastBody.messages?.some((message) => message?.content === "force-paid")
  if (forcePaid && Array.isArray(lastBody.models)) {
    const data = JSON.stringify({ error: { message: "free routes exhausted" } })
    res.writeHead(429, { "content-type": "application/json", "content-length": Buffer.byteLength(data) })
    res.end(data)
    return
  }
  if (lastBody.stream) {
    res.writeHead(200, { "content-type": "text/event-stream" })
    res.write(`data: ${JSON.stringify({ id: "x", model: "cohere/north-mini-code:free", choices: [{ delta: { content: "ok" } }] })}\n\n`)
    res.end("data: [DONE]\n\n")
    return
  }
  const data = JSON.stringify({
    id: "x",
    model: "qwen/qwen3-coder:free",
    choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
  })
  res.writeHead(200, { "content-type": "application/json", "content-length": Buffer.byteLength(data) })
  res.end(data)
})

await new Promise((resolve) => upstream.listen(upstreamPort, "127.0.0.1", resolve))
const dataDir = await mkdtemp(join(tmpdir(), "fryn-router-test-"))
const child = spawn(process.execPath, [new URL("./server.mjs", import.meta.url).pathname], {
  env: {
    ...process.env,
    PORT: String(backendPort),
    FRYN_DATA_DIR: dataDir,
    OPENROUTER_API_KEY: "test-key",
    FRYN_ADMIN_TOKEN: "test-admin-token",
    OPENROUTER_BASE_URL: `http://127.0.0.1:${upstreamPort}`,
    FRYN_ENABLE_PAID_FALLBACK: "true",
  },
  stdio: ["ignore", "pipe", "pipe"],
})

async function waitForHealth() {
  for (let i = 0; i < 50; i++) {
    try {
      const response = await fetch(`http://127.0.0.1:${backendPort}/health`)
      if (response.ok) return response.json()
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error("backend did not start")
}

try {
  const health = await waitForHealth()
  assert.equal(health.routing.freeFirst, true)
  assert.equal(health.routing.paidFallback, true)

  const activation = await fetch(`http://127.0.0.1:${backendPort}/api/activate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ installationId: "install_1234567890abcdef", deviceName: "TEST-PC" }),
  })
  assert.equal(activation.status, 200)
  const { token } = await activation.json()
  assert.ok(token.startsWith("fryn_"))

  for (let slot = 2; slot <= 12; slot++) {
    const extra = await fetch(`http://127.0.0.1:${backendPort}/api/activate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ installationId: `install_${String(slot).padStart(16, "0")}`, deviceName: `TEST-PC-${slot}` }),
    })
    assert.equal(extra.status, 200)
  }
  const thirteenth = await fetch(`http://127.0.0.1:${backendPort}/api/activate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ installationId: "install_9999999999999999", deviceName: "TEST-PC-13" }),
  })
  assert.equal(thirteenth.status, 403)
  assert.equal((await thirteenth.json()).error, "license_limit")

  const models = await fetch(`http://127.0.0.1:${backendPort}/v1/models`, {
    headers: { authorization: `Bearer ${token}` },
  }).then((r) => r.json())
  assert.deepEqual(models.data.map((item) => item.id), ["assistant"])

  const request = await fetch(`http://127.0.0.1:${backendPort}/v1/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ model: "assistant", messages: [{ role: "user", content: "test" }] }),
  })
  const text = await request.text()
  assert.equal(request.status, 200)
  assert.deepEqual(lastBody.models, expectedFree)
  assert.equal("model" in lastBody, false)
  assert.equal(lastBody.provider.data_collection, "allow")
  assert.ok(text.includes('"model":"assistant"'))
  assert.ok(!/cohere|qwen|openrouter/i.test(text))

  const beforePaid = seenBodies.length
  const paidRequest = await fetch(`http://127.0.0.1:${backendPort}/v1/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ model: "assistant", messages: [{ role: "user", content: "force-paid" }] }),
  })
  const paidText = await paidRequest.text()
  assert.equal(paidRequest.status, 200)
  const paidAttempts = seenBodies.slice(beforePaid)
  assert.equal(paidAttempts.length, 2)
  assert.deepEqual(paidAttempts[0].models, expectedFree)
  assert.equal("model" in paidAttempts[0], false)
  assert.equal(paidAttempts[1].model, expectedPaid)
  assert.equal("models" in paidAttempts[1], false)
  assert.ok(paidText.includes('"model":"assistant"'))
  assert.ok(!/cohere|qwen|openrouter/i.test(paidText))

  const stream = await fetch(`http://127.0.0.1:${backendPort}/v1/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ model: "assistant", stream: true, messages: [{ role: "user", content: "test" }] }),
  })
  const streamed = await stream.text()
  assert.equal(stream.status, 200)
  assert.ok(streamed.includes('"model":"assistant"'))
  assert.ok(!/cohere|qwen|openrouter/i.test(streamed))

  console.log("Fryn routing test: OK")
} finally {
  child.kill("SIGTERM")
  upstream.close()
  await rm(dataDir, { recursive: true, force: true })
}
