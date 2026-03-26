import { writeHeapSnapshot } from "node:v8";
import type { Event } from "@opencode-ai/sdk/v2";
import { Bus } from "@/bus";
import { GlobalBus } from "@/bus/global";
import { upgrade } from "@/cli/upgrade";
import { Config } from "@/config/config";
import { WorkspaceID } from "@/control-plane/schema";
import { Flag } from "@/flag/flag";
import { Installation } from "@/installation";
import { InstanceBootstrap } from "@/project/bootstrap";
import { Instance } from "@/project/instance";
import { Server } from "@/server/server";
import { Log } from "@/util/log";
import { Rpc } from "@/util/rpc";

await Log.init({
  print: process.argv.includes("--print-logs"),
  dev: Installation.isLocal(),
  level: (() => {
    if (Installation.isLocal()) return "DEBUG";
    return "INFO";
  })(),
});

process.on("unhandledRejection", (e) => {
  Log.Default.error("rejection", {
    e: e instanceof Error ? e.message : e,
  });
});

process.on("uncaughtException", (e) => {
  Log.Default.error("exception", {
    e: e instanceof Error ? e.message : e,
  });
});

// Forward instance-scoped bus events to the TUI thread via RPC.
// Bus.publish() emits on GlobalBus with { directory, payload }.
// The TUI's createEventSource listens for "event" RPC messages.
GlobalBus.on("event", (event) => {
  Rpc.emit("global.event", event);
  Rpc.emit("event", event.payload as Event);
});

let server: Awaited<ReturnType<typeof Server.listen>> | undefined;

export const rpc = {
  async fetch(input: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: string;
  }) {
    const headers = { ...input.headers };
    const auth = getAuthorizationHeader();
    if (auth && !headers["authorization"] && !headers["Authorization"]) {
      headers["Authorization"] = auth;
    }
    const request = new Request(input.url, {
      method: input.method,
      headers,
      body: input.body,
    });
    const response = await Server.Default().fetch(request);
    const body = await response.text();
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body,
    };
  },
  snapshot() {
    const result = writeHeapSnapshot("server.heapsnapshot");
    return result;
  },
  async server(input: { port: number; hostname: string; mdns?: boolean; cors?: string[] }) {
    if (server) await server.stop(true);
    server = await Server.listen(input);
    return { url: server.url.toString() };
  },
  async checkUpgrade(input: { directory: string }) {
    // Fire-and-forget: do not await. A hanging upgrade check (e.g. Bun
    // child-process stream bug) must not block the worker event loop or
    // prevent HTTP request processing.
    Instance.provide({
      directory: input.directory,
      init: InstanceBootstrap,
      fn: async () => {
        await upgrade().catch(() => {});
      },
    }).catch((err) =>
      Log.Default.warn("checkUpgrade failed", {
        error: err instanceof Error ? err.message : String(err),
      })
    );
  },
  async reload() {
    await Config.invalidate(true);
  },
  async setWorkspace(_input: { workspaceID?: string }) {
    // No-op: GlobalBus bridge forwards all events regardless of workspace
  },
  async shutdown() {
    Log.Default.info("worker shutting down");
    await Instance.disposeAll();
    if (server) await server.stop(true);
  },
};

Rpc.listen(rpc);

function getAuthorizationHeader(): string | undefined {
  const password = Flag.OPENCODE_SERVER_PASSWORD;
  if (!password) return undefined;
  const username = Flag.OPENCODE_SERVER_USERNAME ?? "opencode";
  return `Basic ${btoa(`${username}:${password}`)}`;
}
