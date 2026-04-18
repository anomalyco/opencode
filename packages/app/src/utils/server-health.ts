import { usePlatform } from "@/context/platform";
import type { ServerConnection } from "@/context/server";
import { createSdkForServer } from "./server";

export type ServerHealth = { healthy: boolean; version?: string; unauthorized?: boolean };

interface CheckServerHealthOptions {
	timeoutMs?: number;
	signal?: AbortSignal;
	retryCount?: number;
	retryDelayMs?: number;
}

const defaultTimeoutMs = 3000;
const defaultRetryCount = 2;
const defaultRetryDelayMs = 100;

function timeoutSignal(timeoutMs: number) {
	const timeout = (AbortSignal as unknown as { timeout?: (ms: number) => AbortSignal }).timeout;
	if (timeout) {
		try {
			return {
				signal: timeout.call(AbortSignal, timeoutMs),
				clear: undefined as (() => void) | undefined,
			};
		} catch {}
	}
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

function wait(ms: number, signal?: AbortSignal) {
	return new Promise<void>((resolve, reject) => {
		if (signal?.aborted) {
			reject(new DOMException("Aborted", "AbortError"));
			return;
		}
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		const onAbort = () => {
			clearTimeout(timer);
			reject(new DOMException("Aborted", "AbortError"));
		};
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

function retryable(error: unknown, signal?: AbortSignal) {
	if (signal?.aborted) return false;
	if (!(error instanceof Error)) return false;
	if (error.name === "AbortError" || error.name === "TimeoutError") return false;
	if (error instanceof TypeError) return true;
	return /network|fetch|econnreset|econnrefused|enotfound|timedout/i.test(error.message);
}

function isUnauthorized(error: unknown): boolean {
	if (error && typeof error === "object") {
		const e = error as Record<string, unknown>;
		if (e.status === 401 || e.status === "401") return true;
		const msg = String(e.message || e.error || "");
		if (msg.includes("401") || msg.toLowerCase().includes("unauthorized")) return true;
	}
	return false;
}

export function healthOk(input: unknown) {
	if (!input || typeof input !== "object") return false;
	const value = input as Record<string, unknown>;
	if ("healthy" in value) return value.healthy === true;
	if ("ok" in value) return value.ok === true;
	return false;
}

export function healthVersion(input: unknown) {
	if (!input || typeof input !== "object") return undefined;
	const value = input as Record<string, unknown>;
	return typeof value.version === "string" ? value.version : undefined;
}

export async function checkServerHealth(
	server: ServerConnection.HttpBase,
	fetch: typeof globalThis.fetch,
	opts?: CheckServerHealthOptions,
): Promise<ServerHealth> {
	const timeout = opts?.signal ? undefined : timeoutSignal(opts?.timeoutMs ?? defaultTimeoutMs);
	const signal = opts?.signal ?? timeout?.signal;
	const retryCount = opts?.retryCount ?? defaultRetryCount;
	const retryDelayMs = opts?.retryDelayMs ?? defaultRetryDelayMs;
	const next = (count: number, error: unknown, unauth = false) => {
		const fail = () => (unauth ? ({ healthy: false, unauthorized: true } as const) : ({ healthy: false } as const));
		if (count >= retryCount || !retryable(error, signal))
			return Promise.resolve(fail());
		return wait(retryDelayMs * (count + 1), signal)
			.then(() => attempt(count + 1))
			.catch(() => fail());
	};
	const attempt = (count: number): Promise<ServerHealth> =>
		createSdkForServer({
			server,
			fetch,
			signal,
		})
			.global.health()
			.then((x) => {
				if (x.error) {
					const unauth = isUnauthorized(x.error);
					return next(count, x.error, unauth);
				}
				return { healthy: healthOk(x.data), version: healthVersion(x.data) };
			})
			.catch((error) => next(count, error));
	return attempt(0).finally(() => timeout?.clear?.());
}

export function useCheckServerHealth() {
	const platform = usePlatform();
	const fetcher = platform.fetch ?? globalThis.fetch;

	return (http: ServerConnection.HttpBase) => checkServerHealth(http, fetcher);
}
