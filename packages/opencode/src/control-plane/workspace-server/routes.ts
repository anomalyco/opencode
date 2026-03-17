import { GlobalBus } from "../../bus/global";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { Log } from "@/util/log";

const log = Log.create({ service: "workspace-server" });

export function WorkspaceServerRoutes() {
	return new Hono().get("/event", async (c) => {
		c.header("X-Accel-Buffering", "no");
		c.header("X-Content-Type-Options", "nosniff");
		return streamSSE(c, async (stream) => {
			await new Promise<void>((resolve) => {
				let done = false;
				let timer: ReturnType<typeof setInterval> | undefined;

				const stop = (reason: string) => {
					if (done) return;
					done = true;
					if (timer) clearInterval(timer);
					GlobalBus.off("event", handler);
					c.req.raw.signal.removeEventListener("abort", abort);
					log.info("workspace event disconnected", {
						reason,
						listeners: GlobalBus.listenerCount("event"),
					});
					resolve();
				};

				const send = (event: unknown) =>
					stream
						.writeSSE({
							data: JSON.stringify(event),
						})
						.then(
							() => true,
							() => {
								stop("write");
								return false;
							},
						);

				const handler = (event: { directory?: string; payload: unknown }) => {
					void send(event.payload);
				};

				const abort = () => stop("abort");

				GlobalBus.on("event", handler);
				log.info("workspace event connected", {
					listeners: GlobalBus.listenerCount("event"),
				});
				stream.onAbort(abort);
				c.req.raw.signal.addEventListener("abort", abort, { once: true });
				void send({ type: "server.connected", properties: {} });
				timer = setInterval(() => {
					void send({ type: "server.heartbeat", properties: {} });
				}, 10_000);
			});
		});
	});
}
