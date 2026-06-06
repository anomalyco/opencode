import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import { loadConfig } from "./config.js";
import { OpenCodeSSEClient } from "./sse-client.js";
import { StateManager } from "./state-manager.js";
import { WebSocketHub } from "./ws-hub.js";
import { createRestApi } from "./rest-api.js";

async function main(): Promise<void> {
  const config = loadConfig();
  console.log("[Observer] Starting with config:", {
    port: config.port,
    opencodeUrl: config.opencodeUrl,
    opencodeDirectory: config.opencodeDirectory || "(none)",
    heartbeatInterval: config.heartbeatInterval,
  });

  // Initialize Express app
  const app = express();
  app.use(express.json());

  // Create HTTP server
  const server = createServer(app);

  // Create WebSocket server attached to the HTTP server
  const wss = new WebSocketServer({ server, path: "/ws" });

  // Initialize components
  const stateManager = new StateManager(config);
  const sseClient = new OpenCodeSSEClient(config);
  const wsHub = new WebSocketHub(config, stateManager);

  // Wire up SSE events -> state manager -> WebSocket hub
  sseClient.onEvent((event) => {
    stateManager.processEvent(event);
  });

  stateManager.onChange((messages) => {
    wsHub.broadcast(messages);
  });

  // Set up REST API routes
  createRestApi(app, config, stateManager, sseClient);

  // Handle WebSocket connections
  wss.on("connection", (ws) => {
    wsHub.addClient(ws);
  });

  // Start WebSocket hub heartbeat
  wsHub.start();

  // Start SSE client
  sseClient.start();

  // Load initial data after a short delay to allow SSE connection
  setTimeout(async () => {
    try {
      await stateManager.loadInitialData();
      console.log("[Observer] Initial data loaded");
    } catch (err) {
      console.error("[Observer] Failed to load initial data:", err);
    }
  }, 1000);

  // Start HTTP server
  server.listen(config.port, () => {
    console.log(`[Observer] Server running at http://localhost:${config.port}`);
    console.log(`[Observer] WebSocket endpoint at ws://localhost:${config.port}/ws`);
  });

  // Graceful shutdown
  const shutdown = (signal: string) => {
    console.log(`\n[Observer] Received ${signal}, shutting down gracefully...`);

    sseClient.stop();
    wsHub.stop();

    wss.close(() => {
      server.close(() => {
        console.log("[Observer] Server stopped");
        process.exit(0);
      });
    });

    // Force exit after 5 seconds
    setTimeout(() => {
      console.error("[Observer] Forced shutdown after timeout");
      process.exit(1);
    }, 5000);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[Observer] Fatal error:", err);
  process.exit(1);
});
