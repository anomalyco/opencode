import { Installation } from "@/installation";
import { Log } from "@/util/log";
import { Database as SqliteDatabase } from "../storage/db";
import { getPool } from "../storage/db.pg";

const log = Log.create({ service: "server.health" });

const DEFAULT_TIMEOUT_MS = Number(process.env.VERITLY_HEALTH_TIMEOUT_MS ?? "5000");

export type HealthCheckResult = {
	name: string;
	ok: boolean;
	target?: string;
	detail?: string;
	status?: number;
	latencyMs: number;
};

export type ApiHealthReport = {
	service: "opencode-api";
	ok: boolean;
	version: string;
	checks: HealthCheckResult[];
};

function now() {
	return performance.now();
}

function withTimeout(timeoutMs: number) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort("timeout"), timeoutMs);
	return {
		signal: controller.signal,
		done() {
			clearTimeout(timer);
		},
	};
}

async function timedCheck(
	name: string,
	target: string | undefined,
	fn: (signal: AbortSignal) => Promise<{ ok: boolean; detail?: string; status?: number }>,
): Promise<HealthCheckResult> {
	const startedAt = now();
	const timeout = withTimeout(DEFAULT_TIMEOUT_MS);
	try {
		const result = await fn(timeout.signal);
		return {
			name,
			ok: result.ok,
			target,
			detail: result.detail,
			status: result.status,
			latencyMs: Math.round(now() - startedAt),
		};
	} catch (error) {
		return {
			name,
			ok: false,
			target,
			detail: error instanceof Error ? error.message : String(error),
			latencyMs: Math.round(now() - startedAt),
		};
	} finally {
		timeout.done();
	}
}

function normalizeBaseUrl(input: string) {
	return input.replace(/\/+$/, "");
}

function relayHealthUrl() {
	const explicit = process.env.VERITLY_HEALTH_RELAY_URL?.trim();
	if (explicit) return explicit;
	if (explicit === "") return undefined;

	const ws = process.env.VITE_UNIVER_SDK_WS?.trim();
	if (!ws) return "http://relay:8080/healthz";

	try {
		const url = new URL(ws);
		url.protocol = url.protocol === "wss:" ? "https:" : "http:";
		url.pathname = "/healthz";
		url.search = "";
		url.hash = "";
		return url.toString();
	} catch {
		return undefined;
	}
}

function univerHealthTargets() {
	const raw = process.env.VERITLY_HEALTH_UNIVER_URL?.trim() || process.env.VITE_UNIVER_BACKEND_URL?.trim();
	if (!raw) return [];

	const base = normalizeBaseUrl(raw);
	return [`${base}/healthz`, `${base}/universer-api/license/key`, `${base}/health`];
}

async function checkDatabase() {
	if (process.env.DATABASE_URL?.startsWith("postgresql://")) {
		return timedCheck("database", process.env.DATABASE_URL, async () => {
			await getPool().query("SELECT 1");
			return { ok: true, detail: "postgres reachable" };
		});
	}

	return timedCheck("database", SqliteDatabase.Path, async () => {
		SqliteDatabase.Client().$client.query("select 1").get();
		return { ok: true, detail: "sqlite reachable" };
	});
}

async function checkHttpTarget(name: string, target: string) {
	return timedCheck(name, target, async (signal) => {
		const response = await fetch(target, {
			method: "GET",
			headers: { accept: "application/json, text/plain;q=0.9, */*;q=0.1" },
			signal,
		});
		const ok = response.ok;
		return {
			ok,
			status: response.status,
			detail: ok ? "reachable" : `unexpected status ${response.status}`,
		};
	});
}

async function checkOptionalRelay() {
	const target = relayHealthUrl();
	if (!target) {
		return {
			name: "relay",
			ok: true,
			detail: "skipped (relay url not configured)",
			latencyMs: 0,
		} satisfies HealthCheckResult;
	}
	return checkHttpTarget("relay", target);
}

async function checkOptionalUniver() {
	const targets = univerHealthTargets();
	if (!targets.length) {
		return {
			name: "univer",
			ok: true,
			detail: "skipped (univer url not configured)",
			latencyMs: 0,
		} satisfies HealthCheckResult;
	}

	for (const target of targets) {
		const result = await checkHttpTarget("univer", target);
		if (result.ok) return result;
		log.warn("univer health target failed", {
			target,
			status: result.status,
			detail: result.detail,
		});
	}

	return {
		name: "univer",
		ok: false,
		target: targets[0],
		detail: "all univer health targets failed",
		latencyMs: 0,
	};
}

export async function apiHealthReport(): Promise<ApiHealthReport> {
	const checks = await Promise.all([checkDatabase(), checkOptionalUniver(), checkOptionalRelay()]);
	return {
		service: "opencode-api",
		ok: checks.every((check) => check.ok),
		version: Installation.VERSION,
		checks,
	};
}

export function isPublicHealthPath(path: string) {
	return path === "/health" || path === "/healthz" || path === "/livez";
}
