import type { WebSocket } from "ws";
import type { ClientMessage, ServerMessage } from "../shared/types.js";
import type { StateManager } from "./state-manager.js";
import type { Config } from "./config.js";

interface ClientInfo {
  ws: WebSocket;
  subscriptions: Set<string>;
  isAlive: boolean;
}

export class WebSocketHub {
  private config: Config;
  private stateManager: StateManager;
  private clients = new Map<WebSocket, ClientInfo>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: Config, stateManager: StateManager) {
    this.config = config;
    this.stateManager = stateManager;
  }

  start(): void {
    this.heartbeatTimer = setInterval(() => {
      this.pingAll();
    }, this.config.heartbeatInterval);
  }

  stop(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    for (const [ws] of this.clients) {
      ws.terminate();
    }
    this.clients.clear();
  }

  addClient(ws: WebSocket): void {
    const clientInfo: ClientInfo = {
      ws,
      subscriptions: new Set(),
      isAlive: true,
    };
    this.clients.set(ws, clientInfo);

    this.send(ws, { type: "connected" });

    ws.on("message", (raw: unknown) => {
      this.handleMessage(ws, raw);
    });

    ws.on("pong", () => {
      const client = this.clients.get(ws);
      if (client) {
        client.isAlive = true;
      }
    });

    ws.on("close", () => {
      this.removeClient(ws);
    });

    ws.on("error", (err: Error) => {
      console.error("[WS] Client error:", err.message);
      this.removeClient(ws);
    });

    console.log(`[WS] Client connected (total: ${this.clients.size})`);
  }

  removeClient(ws: WebSocket): void {
    this.clients.delete(ws);
    console.log(`[WS] Client disconnected (total: ${this.clients.size})`);
  }

  broadcast(messages: ServerMessage[]): void {
    for (const msg of messages) {
      this.broadcastMessage(msg);
    }
  }

  private handleMessage(ws: WebSocket, raw: unknown): void {
    try {
      const data = typeof raw === "string" ? raw : new TextDecoder().decode(raw as Uint8Array);
      const message = JSON.parse(data) as ClientMessage;

      switch (message.type) {
        case "subscribe":
          this.handleSubscribe(ws, message.sessionID);
          break;
        case "unsubscribe":
          this.handleUnsubscribe(ws, message.sessionID);
          break;
        case "ping":
          this.send(ws, { type: "pong" });
          break;
        case "get.sessions":
          this.handleGetSessions(ws);
          break;
        case "get.messages":
          this.handleGetMessages(ws, message.sessionID);
          break;
        default:
          this.send(ws, { type: "error", message: `Unknown message type: ${(message as { type: string }).type}` });
      }
    } catch {
      this.send(ws, { type: "error", message: "Invalid message format" });
    }
  }

  private handleSubscribe(ws: WebSocket, sessionID: string): void {
    const client = this.clients.get(ws);
    if (!client) return;

    client.subscriptions.add(sessionID);
    console.log(`[WS] Client subscribed to ${sessionID}`);

    // Send current session status
    const status = this.stateManager.getSessionStatus(sessionID);
    this.send(ws, { type: "session.status", sessionID, status });

    // Send cached messages for this session
    const messages = this.stateManager.getMessages(sessionID);
    if (messages.length > 0) {
      this.send(ws, { type: "session.messages", sessionID, messages });
    }
  }

  private handleUnsubscribe(ws: WebSocket, sessionID: string): void {
    const client = this.clients.get(ws);
    if (!client) return;

    client.subscriptions.delete(sessionID);
    console.log(`[WS] Client unsubscribed from ${sessionID}`);
  }

  private handleGetSessions(ws: WebSocket): void {
    const sessions = this.stateManager.getSessions();
    this.send(ws, { type: "session.list", sessions });
  }

  private async handleGetMessages(ws: WebSocket, sessionID: string): Promise<void> {
    // Try cache first, then fetch from opencode API
    let messages = this.stateManager.getMessages(sessionID);
    if (messages.length === 0) {
      messages = await this.stateManager.fetchMessages(sessionID);
    }
    this.send(ws, { type: "session.messages", sessionID, messages });
  }

  private broadcastMessage(msg: ServerMessage): void {
    const sessionID = this.extractSessionID(msg);
    const messageStr = JSON.stringify(msg);

    for (const [, client] of this.clients) {
      if (client.ws.readyState !== 1) continue; // WebSocket.OPEN = 1

      // If the message is session-specific, only send to subscribed clients
      if (sessionID) {
        if (client.subscriptions.has(sessionID)) {
          client.ws.send(messageStr);
        }
      } else {
        // Broadcast to all connected clients (e.g., session.list, session.created)
        client.ws.send(messageStr);
      }
    }
  }

  private extractSessionID(msg: ServerMessage): string | null {
    switch (msg.type) {
      case "session.status":
      case "session.deleted":
      case "session.messages":
      case "message.updated":
      case "part.updated":
      case "text.delta":
      case "reasoning.delta":
      case "tool.progress":
      case "step.started":
      case "step.ended":
        return msg.sessionID;
      case "session.created":
      case "session.updated":
        return msg.session.id;
      case "session.list":
      case "connected":
      case "pong":
      case "error":
        return null;
    }
  }

  private send(ws: WebSocket, msg: ServerMessage): void {
    if (ws.readyState !== 1) return; // WebSocket.OPEN = 1
    try {
      ws.send(JSON.stringify(msg));
    } catch (err) {
      console.error("[WS] Send error:", err);
    }
  }

  private pingAll(): void {
    for (const [ws, client] of this.clients) {
      if (!client.isAlive) {
        console.log("[WS] Terminating dead connection");
        ws.terminate();
        this.clients.delete(ws);
        continue;
      }
      client.isAlive = false;
      ws.ping();
    }
  }

  getClientCount(): number {
    return this.clients.size;
  }
}
