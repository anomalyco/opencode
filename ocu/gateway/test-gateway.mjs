import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createServer } from "./gateway.mjs";

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return "http://127.0.0.1:" + server.address().port;
}

async function close(server) {
  await new Promise((resolve) => server.close(resolve));
}

function mockProvider(handler) {
  return http.createServer(async (req, res) => {
    if (req.url !== "/v1/chat/completions") return res.writeHead(404).end();
    let body = "";
    for await (const chunk of req) body += chunk;
    handler(req, res, JSON.parse(body));
  });
}

test("health and models expose only enabled aliases", async () => {
  const server = createServer({ providers: [
    { id: "p1", enabled: true, models: [{ alias: "ocu/auto", upstreamModel: "m1" }] },
    { id: "p2", enabled: false, models: [{ alias: "ocu/hidden", upstreamModel: "m2" }] }
  ] });
  const base = await listen(server);
  try {
    const health = await fetch(base + "/health").then((r) => r.json());
    assert.equal(health.status, "ok");
    assert.equal(health.providers, 1);
    const models = await fetch(base + "/v1/models").then((r) => r.json());
    assert.deepEqual(models.data.map((item) => item.id), ["ocu/auto"]);
  } finally { await close(server); }
});

test("inbound bearer key is required when configured", async () => {
  const previous = process.env.OCU_GATEWAY_KEY;
  process.env.OCU_GATEWAY_KEY = "test-secret";
  const server = createServer({ providers: [] });
  const base = await listen(server);
  try {
    assert.equal((await fetch(base + "/health")).status, 401);
    assert.equal((await fetch(base + "/health", { headers: { authorization: "Bearer test-secret" } })).status, 200);
  } finally {
    await close(server);
    if (previous === undefined) delete process.env.OCU_GATEWAY_KEY;
    else process.env.OCU_GATEWAY_KEY = previous;
  }
});

test("automatic model falls back after an upstream 503", async () => {
  const first = mockProvider((_req, res) => res.writeHead(503).end("unavailable"));
  const second = mockProvider((_req, res, body) => {
    assert.equal(body.model, "model-two");
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: "ok", choices: [{ message: { role: "assistant", content: "hello" } }] }));
  });
  const firstUrl = await listen(first);
  const secondUrl = await listen(second);
  const gateway = createServer({
    requestTimeoutMs: 3000, cooldownBaseMs: 10, cooldownMaxMs: 100,
    providers: [
      { id: "first", baseURL: firstUrl + "/v1", priority: 1, enabled: true, models: [{ alias: "ocu/auto", upstreamModel: "model-one" }] },
      { id: "second", baseURL: secondUrl + "/v1", priority: 2, enabled: true, models: [{ alias: "ocu/auto", upstreamModel: "model-two" }] }
    ]
  });
  const gatewayUrl = await listen(gateway);
  try {
    const response = await fetch(gatewayUrl + "/v1/chat/completions", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "ocu/auto", messages: [{ role: "user", content: "hi" }] })
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).choices[0].message.content, "hello");
  } finally {
    await close(gateway); await close(first); await close(second);
  }
});


test("provider in cooldown is not retried until its cooldown expires", async () => {
  let calls = 0;
  const upstream = mockProvider((_req, res) => {
    calls += 1;
    res.writeHead(503).end("unavailable");
  });
  const upstreamUrl = await listen(upstream);
  const gateway = createServer({
    requestTimeoutMs: 3000, cooldownBaseMs: 10000, cooldownMaxMs: 10000,
    providers: [{
      id: "cooldown-regression-provider",
      baseURL: upstreamUrl + "/v1",
      priority: 1,
      enabled: true,
      models: [
        { alias: "ocu/auto", upstreamModel: "test-model" },
        { alias: "ocu/cloud", upstreamModel: "test-model" }
      ]
    }]
  });
  const gatewayUrl = await listen(gateway);
  try {
    const request = () => fetch(gatewayUrl + "/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "ocu/auto", messages: [{ role: "user", content: "test" }] })
    });
    const firstResponse = await request();
    const firstBody = await firstResponse.text();
    assert.equal(firstResponse.status, 503, "first response: " + firstBody + "; upstream calls: " + calls);
    const second = await request();
    assert.equal(second.status, 503);
    assert.match((await second.json()).error.message, /cooling down/i);
    assert.equal(calls, 1);
  } finally {
    await close(gateway);
    await close(upstream);
  }
});
