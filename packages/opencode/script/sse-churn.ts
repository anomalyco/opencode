const base = process.env.OPENCODE_BASE_URL || "http://127.0.0.1:4096";
const user = process.env.OPENCODE_SERVER_USERNAME || "opencode";
const pass = process.env.OPENCODE_SERVER_PASSWORD || "";
const total = Number(process.env.SSE_CHURN_TOTAL || "200");
const rate = Number(process.env.SSE_CHURN_RATE || "10");
const hold = Number(process.env.SSE_CHURN_HOLD_MS || "250");

const auth = pass ? `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}` : undefined;

const run = async (id: number) => {
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), hold);
	try {
		const res = await fetch(`${base}/global/event`, {
			headers: auth ? { authorization: auth, accept: "text/event-stream" } : { accept: "text/event-stream" },
			signal: ctrl.signal,
		});
		if (!res.ok) throw new Error(`request ${id} failed with ${res.status}`);
		const reader = res.body?.getReader();
		if (!reader) return;
		await reader.read().catch(() => undefined);
	} finally {
		clearTimeout(timer);
		ctrl.abort();
	}
};

let ok = 0;
let fail = 0;

for (let i = 0; i < total; i += rate) {
	const batch = Array.from({ length: Math.min(rate, total - i) }, (_, j) =>
		run(i + j + 1).then(
			() => ok++,
			(err) => {
				fail++;
				console.error(err instanceof Error ? err.message : String(err));
			},
		),
	);
	await Promise.all(batch);
	console.log(`completed ${Math.min(i + rate, total)}/${total} ok=${ok} fail=${fail}`);
}

console.log(`done ok=${ok} fail=${fail}`);
