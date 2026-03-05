import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { describeRoute, resolver, validator } from "hono-openapi";
import z from "zod";
import { BusEvent } from "@/bus/bus-event";
import { GlobalBus } from "@/bus/global";
import { Installation } from "@/installation";
import { Config } from "../../config/config";
import { Instance } from "../../project/instance";
import { lazy } from "../../util/lazy";
import { Log } from "../../util/log";
import { errors } from "../error";

const log = Log.create({ service: "server" });

export const GlobalDisposedEvent = BusEvent.define(
	"global.disposed",
	z.object({}),
);

export const GlobalRoutes = lazy(() =>
	new Hono()
		.get(
			"/health",
			describeRoute({
				summary: "Get health",
				description: "Get health information about the OpenCode server.",
				operationId: "global.health",
				responses: {
					200: {
						description: "Health information",
						content: {
							"application/json": {
								schema: resolver(
									z.object({ healthy: z.literal(true), version: z.string() }),
								),
							},
						},
					},
				},
			}),
			async (c) => {
				return c.json({ healthy: true, version: Installation.VERSION });
			},
		)
		.get(
			"/event",
			describeRoute({
				summary: "Get global events",
				description:
					"Subscribe to global events from the OpenCode system using server-sent events.",
				operationId: "global.event",
				responses: {
					200: {
						description: "Event stream",
						content: {
							"text/event-stream": {
								schema: resolver(
									z
										.object({
											directory: z.string(),
											payload: BusEvent.payloads(),
										})
										.meta({
											ref: "GlobalEvent",
										}),
								),
							},
						},
					},
				},
			}),
			async (c) => {
				log.info("global event connected");
				c.header("X-Accel-Buffering", "no");
				c.header("X-Content-Type-Options", "nosniff");
				return streamSSE(c, async (stream) => {
					stream.writeSSE({
						data: JSON.stringify({
							payload: {
								type: "server.connected",
								properties: {},
							},
						}),
					});
					async function handler(event: any) {
						await stream.writeSSE({
							data: JSON.stringify(event),
						});
					}
					GlobalBus.on("event", handler);

					// Send heartbeat every 10s to prevent stalled proxy streams.
					const heartbeat = setInterval(() => {
						stream.writeSSE({
							data: JSON.stringify({
								payload: {
									type: "server.heartbeat",
									properties: {},
								},
							}),
						});
					}, 10_000);

					await new Promise<void>((resolve) => {
						stream.onAbort(() => {
							clearInterval(heartbeat);
							GlobalBus.off("event", handler);
							resolve();
							log.info("global event disconnected");
						});
					});
				});
			},
		)
		.get(
			"/config",
			describeRoute({
				summary: "Get global configuration",
				description:
					"Retrieve the current global OpenCode configuration settings and preferences.",
				operationId: "global.config.get",
				responses: {
					200: {
						description: "Get global config info",
						content: {
							"application/json": {
								schema: resolver(Config.Info),
							},
						},
					},
				},
			}),
			async (c) => {
				return c.json(await Config.getGlobal());
			},
		)
		.patch(
			"/config",
			describeRoute({
				summary: "Update global configuration",
				description:
					"Update global OpenCode configuration settings and preferences.",
				operationId: "global.config.update",
				responses: {
					200: {
						description: "Successfully updated global config",
						content: {
							"application/json": {
								schema: resolver(Config.Info),
							},
						},
					},
					...errors(400),
				},
			}),
			validator("json", Config.Info),
			async (c) => {
				const config = c.req.valid("json");
				const next = await Config.updateGlobal(config);
				return c.json(next);
			},
		)
		.post(
			"/dispose",
			describeRoute({
				summary: "Dispose instance",
				description:
					"Clean up and dispose all OpenCode instances, releasing all resources.",
				operationId: "global.dispose",
				responses: {
					200: {
						description: "Global disposed",
						content: {
							"application/json": {
								schema: resolver(z.boolean()),
							},
						},
					},
				},
			}),
			async (c) => {
				await Instance.disposeAll();
				GlobalBus.emit("event", {
					directory: "global",
					payload: {
						type: GlobalDisposedEvent.type,
						properties: {},
					},
				});
				return c.json(true);
			},
		)
		.get(
			"/instances",
			describeRoute({
				summary: "List instances",
				description:
					"List all cached OpenCode instances with their reference counts.",
				operationId: "global.instances.list",
				responses: {
					200: {
						description: "List of cached instances",
						content: {
							"application/json": {
								schema: resolver(
									z
										.object({
											directory: z.string(),
											refs: z.number(),
										})
										.array()
										.meta({
											ref: "InstanceList",
										}),
								),
							},
						},
					},
				},
			}),
			async (c) => {
				return c.json(Instance.list());
			},
		)
		.post(
			"/instances/dispose",
			describeRoute({
				summary: "Dispose instance by directory",
				description:
					"Dispose a specific OpenCode instance by directory path, releasing its LSP servers, MCP connections, and cached state.",
				operationId: "global.instances.dispose",
				responses: {
					200: {
						description: "Instance disposed",
						content: {
							"application/json": {
								schema: resolver(z.boolean()),
							},
						},
					},
					...errors(400),
				},
			}),
			validator(
				"json",
				z.object({
					directory: z
						.string()
						.meta({ description: "Directory path of instance to dispose" }),
				}),
			),
			async (c) => {
				const dir = c.req.valid("json").directory;
				const disposed = await Instance.disposeByDirectory(dir);
				return c.json(disposed);
			},
		),
);
