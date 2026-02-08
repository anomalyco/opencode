/**
 * Logging utilities for the gateway server
 */
import crypto from "node:crypto";
import fs from "node:fs";

const ENABLE_FILE_LOGGING = process.env.CLAXEDO_FILE_LOGGING === "true";

export function makeReqId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `req_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }
}

export function nowMs(): number {
  return Date.now();
}

export function logJson(
  level: "info" | "warn" | "error",
  payload: Record<string, unknown>
): void {
  const time = new Date().toLocaleTimeString();
  const kind = payload.kind ? `[${payload.kind}]` : "";

  // Build readable key=value pairs (skip 'kind' since we show it separately)
  const details = Object.entries(payload)
    .filter(([k]) => k !== "kind")
    .map(([k, v]) => {
      if (v === undefined || v === null) return null;
      if (typeof v === "object") return `${k}=${JSON.stringify(v)}`;
      return `${k}=${v}`;
    })
    .filter(Boolean)
    .join(" ");

  const levelTag = level === "error" ? "ERR" : level === "warn" ? "WRN" : "INF";
  const line = `${time} ${levelTag} ${kind} ${details}`.trim();

  // File output (disabled by default, enable with CLAXEDO_FILE_LOGGING=true)
  if (ENABLE_FILE_LOGGING) {
    try {
      const logFile = "claxedo-gateway.log";
      fs.appendFileSync(logFile, line + "\n");
    } catch {
      // Ignore logging errors to prevent crash
    }
  }

  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}
