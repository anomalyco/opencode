import http from "node:http";
import fs from "node:fs";
import process from "node:process";
import { pathToFileURL } from "node:url";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8787;
const DEFAULT_MAX_BYTES = 1024 * 1024;
const cooldowns = new Map();
const failures = new Map();

function positive(value, fallback) {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function validateProvider(provider, index) {
  if (!provider || typeof provider !== "object") throw new Error("Invalid provider at index " + index);
  const id = String(provider.id || "").trim();
  const baseURL = String(provider.baseURL || "").replace(/\/+$/, "");
  if (!id || !/^https?:\/\//i.test(baseURL)) throw new Error("Provider requires id and an http(s) baseURL");
  if (!Array.isArray(provider.models) || provider.models.length === 0) throw new Error("Provider " + id + " has no models");
  return {
    id,
    name: String(provider.name || id),
    baseURL,
    apiKeyEnv: String(provider.apiKeyEnv || ""),
    priority: Number.isFinite(provider.priority) ? provider.priority : 100,
    enabled: provider.enabled !== false,
    models: provider.models.map((model) => {
      const alias = String(model.alias || "").trim();
      const upstreamModel = String(model.upstreamModel || "").trim();
      if (!alias || !upstreamModel) throw new Error("Invalid model mapping for provider " + id);
      return { alias, upstreamModel };
    })
  };
}

export function loadConfig(file = process.env.OCU_CONFIG || new URL("./config.json", import.meta.url)) {
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(parsed.providers)) throw new Error("config.providers must be an array");
  return {
    requestTimeoutMs: positive(parsed.requestTimeoutMs, 45000),
    maxRequestBytes: positive(parsed.maxRequestBytes, DEFAULT_MAX_BYTES),
    cooldownBaseMs: positive(parsed.cooldownBaseMs, 15000),
    cooldownMaxMs: positive(parsed.cooldownMaxMs, 300000),
    providers: parsed.providers.map(validateProvider)
  };
}

function sendJson(res, status, body) {
  if (res.headersSent || res.destroyed) return;
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(data),
    "cache-control": "no-store"
  });
  res.end(data);
}

function bearer(req) {
  const value = String(req.headers.authorization || "");
  return value.startsWith("Bearer ") ? value.slice(7) : "";
}

function isLoopback(host) {
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

async function readBody(req, maxBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw Object.assign(new Error("Request body too large"), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function candidatesFor(config, requestedModel) {
  const automatic = requestedModel === "ocu/auto" || requestedModel === "auto";
  return config.providers
    .filter((provider) => provider.enabled)
    .flatMap((provider) => {
      // Auto routing must try each provider only once. Prefer its explicit auto
      // mapping; otherwise use its first configured model as the provider default.
      const mapping = automatic
        ? (provider.models.find((item) => item.alias === "ocu/auto") || provider.models[0])
        : provider.models.find((item) => item.alias === requestedModel);
      return mapping ? [{ provider, mapping }] : [];
    })
    .sort((a, b) => a.provider.priority - b.provider.priority);
}

function cooldownRemaining(id) {
  return Math.max(0, (cooldowns.get(id) || 0) - Date.now());
}

function setCooldown(config, provider, retryAfter) {
  const count = (failures.get(provider.id) || 0) + 1;
  failures.set(provider.id, count);
  const exponential = Math.min(config.cooldownMaxMs, config.cooldownBaseMs * (2 ** Math.min(count - 1, 8)));
  cooldowns.set(provider.id, Date.now() + Math.max(exponential, Math.min(retryAfter || 0, config.cooldownMaxMs)));
}

function retryAfterMs(value) {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 0;
}

function clearFailure(id) {
  failures.delete(id);
  cooldowns.delete(id);
}

function safeError(status, message) {
  return { error: { message, type: "ocu_upstream_error", code: status } };
}

async function handleChat(req, res, config) {
  let payload;
  try {
    payload = JSON.parse(await readBody(req, config.maxRequestBytes));
  } catch (error) {
    return sendJson(res, error.status || 400, {
      error: { message: error.status === 413 ? "Request body too large" : "Invalid JSON body" }
    });
  }
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.messages) || typeof payload.model !== "string") {
    return sendJson(res, 400, { error: { message: "Expected model and messages fields" } });
  }

  const candidates = candidatesFor(config, payload.model);
  if (!candidates.length) return sendJson(res, 404, { error: { message: "No enabled provider supports model " + payload.model } });

  const available = candidates.filter(({ provider }) => cooldownRemaining(provider.id) === 0);
  if (available.length === 0) {
    const retryMs = Math.min(...candidates.map(({ provider }) => cooldownRemaining(provider.id)).filter((ms) => ms > 0));
    return sendJson(res, 503, {
      error: { message: "All eligible providers are cooling down", type: "ocu_no_provider_available" },
      retry_after_ms: Number.isFinite(retryMs) ? retryMs : null
    });
  }
  let lastStatus = 503;
  let lastMessage = "No provider could complete the request";

  for (const { provider, mapping } of available) {
    const key = provider.apiKeyEnv ? process.env[provider.apiKeyEnv] : "";
    if (provider.apiKeyEnv && !key) {
      lastStatus = 503;
      lastMessage = "Provider credential is not configured";
      continue;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);
    const headers = { "content-type": "application/json", accept: "application/json" };
    if (key) headers.authorization = "Bearer " + key;

    try {
      const upstream = await fetch(provider.baseURL + "/chat/completions", {
        method: "POST",
        headers,
        body: JSON.stringify({ ...payload, model: mapping.upstreamModel }),
        signal: controller.signal
      });

      if (!upstream.ok) {
        clearTimeout(timeout);
        const status = upstream.status;
        const retry = retryAfterMs(upstream.headers.get("retry-after"));
        try { await upstream.body?.cancel(); } catch {}
        if (status === 429 || status >= 500) {
          setCooldown(config, provider, retry);
          lastStatus = status;
          lastMessage = status === 429 ? "Provider rate limit reached" : "Provider returned a server error";
          continue;
        }
        lastStatus = status;
        lastMessage = "Provider rejected the request (HTTP " + status + ")";
        continue;
      }

      clearFailure(provider.id);
      res.writeHead(upstream.status, {
        "content-type": upstream.headers.get("content-type") || "application/json",
        "cache-control": "no-store"
      });
      if (!upstream.body) {
        clearTimeout(timeout);
        return res.end();
      }

      try {
        for await (const chunk of upstream.body) {
          if (res.destroyed) break;
          res.write(chunk);
        }
        if (!res.destroyed) res.end();
      } catch {
        // The response has started; switching providers now would corrupt the stream.
        res.destroy();
      } finally {
        clearTimeout(timeout);
      }
      return;
    } catch (error) {
      clearTimeout(timeout);
      setCooldown(config, provider, 0);
      lastStatus = 502;
      lastMessage = error.name === "AbortError" ? "Provider request timed out" : "Provider connection failed";
    }
  }

  return sendJson(res, lastStatus, safeError(lastStatus, lastMessage));
}

export function createServer(config) {
  return http.createServer(async (req, res) => {
    const gatewayKey = process.env.OCU_GATEWAY_KEY || "";
    if (gatewayKey && bearer(req) !== gatewayKey) return sendJson(res, 401, { error: { message: "Unauthorized" } });

    const url = new URL(req.url || "/", "http://localhost");
    if (req.method === "GET" && url.pathname === "/health") {
      return sendJson(res, 200, { status: "ok", providers: config.providers.filter((p) => p.enabled).length });
    }
    if (req.method === "GET" && url.pathname === "/v1/models") {
      const models = new Map();
      for (const provider of config.providers.filter((p) => p.enabled)) {
        for (const mapping of provider.models) {
          if (!models.has(mapping.alias)) models.set(mapping.alias, { id: mapping.alias, object: "model", owned_by: "ocu" });
        }
      }
      return sendJson(res, 200, { object: "list", data: [...models.values()] });
    }
    if (req.method === "POST" && url.pathname === "/v1/chat/completions") return handleChat(req, res, config);
    return sendJson(res, 404, { error: { message: "Not found" } });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const config = loadConfig();
    const host = process.env.OCU_HOST || DEFAULT_HOST;
    const port = positive(Number(process.env.OCU_PORT), DEFAULT_PORT);
    if (!isLoopback(host) && !process.env.OCU_GATEWAY_KEY) throw new Error("Refusing external bind without OCU_GATEWAY_KEY");
    const server = createServer(config);
    server.listen(port, host, () => process.stdout.write("OCU gateway listening on http://" + host + ":" + port + "\n"));
    const shutdown = () => server.close(() => process.exit(0));
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  } catch (error) {
    process.stderr.write("OCU startup failed: " + error.message + "\n");
    process.exitCode = 1;
  }
}
