import { Hono } from "hono";

const app = new Hono();

const VERITLY_EXECUTOR_MODE = process.env.VERITLY_EXECUTOR_MODE ?? "local";

app.use("*", async (c, next) => {
	console.log(`[executor] ${c.req.method} ${c.req.path}`);
	await next();
});

app.post("/v1/chat", async (c) => {
	const body = await c.req.json();
	console.log("[executor] chat request:", JSON.stringify(body, null, 2));

	if (VERITLY_EXECUTOR_MODE === "local") {
		return c.json({
			id: crypto.randomUUID(),
			role: "assistant",
			content: "This is a placeholder response. Connect an AI provider to enable real responses.",
		});
	}

	return c.json({ error: "Unknown executor mode" }, 500);
});

app.post("/v1/sessions/:sessionId/stream", async (c) => {
	const { sessionId } = c.req.param();
	const body = await c.req.json();
	console.log(`[executor] stream session: ${sessionId}`, JSON.stringify(body, null, 2));

	const encoder = new TextEncoder();
	const stream = new ReadableStream({
		async start(controller) {
			const message = "This is a placeholder response. Connect an AI provider to enable real responses.";
			controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: message })}\n\n`));
			controller.close();
		},
	});

	return new Response(stream, {
		headers: {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
		},
	});
});

app.get("/health", (c) => {
	return c.json({ status: "ok", mode: VERITLY_EXECUTOR_MODE });
});

const port = Number(process.env.PORT ?? "7777");
console.log(`Executor API starting on port ${port} (mode: ${VERITLY_EXECUTOR_MODE})`);

Bun.serve({
	port,
	fetch: app.fetch,
});
