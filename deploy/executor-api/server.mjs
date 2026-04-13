import { spawn } from "node:child_process";
import { createServer } from "node:http";

const port = Number(process.env.PORT || "7777");
const driver = (process.env.EXECUTOR_DRIVER || "stub").trim();
const proxyUrl = (process.env.EXECUTOR_PROXY_URL || "").trim();
const vmexecBin = (process.env.VMEXEC_BIN || "/opt/veritly/bin/veritly-vmexec").trim();
const defaultTimeoutMs = Number(process.env.EXECUTOR_DEFAULT_TIMEOUT_MS || "120000");

function json(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString("utf8");
      if (body.length > 1024 * 1024) {
        reject(new Error("request body too large"));
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

async function runProcess(command, timeoutMs) {
  return await new Promise((resolve) => {
    const child = spawn("/bin/sh", ["-lc", command], {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let finished = false;

    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      child.kill("SIGKILL");
      resolve({
        ok: false,
        exitCode: null,
        stdout,
        stderr: `${stderr}\nexecutor timeout after ${timeoutMs}ms`.trim(),
      });
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("close", (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve({
        ok: code === 0,
        exitCode: code,
        stdout,
        stderr,
      });
    });
    child.on("error", (error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve({
        ok: false,
        exitCode: null,
        stdout,
        stderr: `${stderr}\n${String(error)}`.trim(),
      });
    });
  });
}

async function runVmexec(payload) {
  const args = [];
  if (payload.userId) args.push("--user", String(payload.userId));
  if (payload.sessionId) args.push("--session", String(payload.sessionId));
  if (payload.timeoutMs) args.push("--timeout-ms", String(payload.timeoutMs));
  args.push("--");
  args.push(String(payload.command));

  return await new Promise((resolve) => {
    const child = spawn(vmexecBin, args, {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("close", (code) => {
      resolve({
        ok: code === 0,
        exitCode: code,
        stdout,
        stderr,
        driver: "host-binary",
        vmexecBin,
      });
    });
    child.on("error", (error) => {
      resolve({
        ok: false,
        exitCode: null,
        stdout,
        stderr: `${stderr}\n${String(error)}`.trim(),
        driver: "host-binary",
        vmexecBin,
      });
    });
  });
}

const server = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    return json(res, 200, { ok: true, driver, proxyUrl: proxyUrl || null, vmexecBin });
  }

  if (req.method === "POST" && req.url === "/v1/exec") {
    try {
      const raw = await readBody(req);
      const payload = raw ? JSON.parse(raw) : {};
      const command = String(payload.command || "").trim();
      const timeoutMs = Number(payload.timeoutMs || defaultTimeoutMs);

      if (!command) {
        return json(res, 400, { ok: false, error: "command is required" });
      }

      if (driver === "stub") {
        return json(res, 501, {
          ok: false,
          error:
            "executor driver is stub; configure EXECUTOR_DRIVER=host-binary for a microVM runner or EXECUTOR_DRIVER=proxy to forward to an external executor",
        });
      }

      if (driver === "proxy") {
        if (!proxyUrl) {
          return json(res, 500, { ok: false, error: "EXECUTOR_PROXY_URL is not configured" });
        }
        const upstream = await fetch(new URL("/v1/exec", proxyUrl), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        const text = await upstream.text();
        res.writeHead(upstream.status, { "content-type": upstream.headers.get("content-type") || "application/json" });
        res.end(text);
        return;
      }

      if (driver === "host-binary") {
        const result = await runVmexec({ ...payload, timeoutMs, command });
        return json(res, result.ok ? 200 : 500, result);
      }

      if (driver === "local-process") {
        const result = await runProcess(command, timeoutMs);
        return json(res, result.ok ? 200 : 500, { ...result, driver: "local-process" });
      }

      return json(res, 500, { ok: false, error: `unknown executor driver: ${driver}` });
    } catch (error) {
      return json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return json(res, 404, { ok: false, error: "not found" });
});

server.listen(port, () => {
  console.log(`[executor-api] listening on :${port} driver=${driver}`);
});
