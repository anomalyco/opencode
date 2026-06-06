import type { GlobalEvent } from "../shared/types.js";
import type { Config } from "./config.js";

type EventHandler = (event: GlobalEvent) => void;

export class OpenCodeSSEClient {
  private config: Config;
  private handlers: EventHandler[] = [];
  private abortController: AbortController | null = null;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30000;
  private running = false;
  private connected = false;

  constructor(config: Config) {
    this.config = config;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.connect();
  }

  stop(): void {
    this.running = false;
    this.cleanup();
  }

  isConnected(): boolean {
    return this.connected;
  }

  onEvent(handler: EventHandler): () => void {
    this.handlers.push(handler);
    return () => {
      this.handlers = this.handlers.filter((h) => h !== handler);
    };
  }

  private cleanup(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    this.connected = false;
  }

  private async connect(): Promise<void> {
    if (!this.running) return;

    this.abortController = new AbortController();
    const url = `${this.config.opencodeUrl}/global/event`;

    const headers: Record<string, string> = {
      Accept: "text/event-stream",
      "Cache-Control": "no-cache",
    };

    if (this.config.opencodeDirectory) {
      headers["x-opencode-directory"] = this.config.opencodeDirectory;
    }

    if (this.config.opencodePassword) {
      headers["Authorization"] = `Bearer ${this.config.opencodePassword}`;
    }

    try {
      const response = await fetch(url, {
        method: "GET",
        headers,
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`SSE connection failed: ${response.status} ${response.statusText}`);
      }

      if (!response.body) {
        throw new Error("SSE connection failed: no response body");
      }

      this.connected = true;
      this.reconnectDelay = 1000;
      console.log(`[SSE] Connected to ${url}`);

      await this.parseSSEStream(response.body);
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        return;
      }
      console.error(`[SSE] Connection error:`, err instanceof Error ? err.message : err);
      this.connected = false;
      this.scheduleReconnect();
    }
  }

  private async parseSSEStream(body: ReadableStream<Uint8Array>): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let currentEventType = "";
    let currentData = "";

    try {
      while (this.running) {
        const { done, value } = await reader.read();
        if (done) {
          console.log("[SSE] Stream ended");
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        // Keep the last incomplete line in the buffer
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("event:")) {
            currentEventType = line.slice(6).trim();
          } else if (line.startsWith("data:")) {
            currentData += line.slice(5).trimStart();
          } else if (line === "") {
            // Empty line signals end of event
            if (currentData) {
              this.processSSEEvent(currentEventType, currentData);
            }
            currentEventType = "";
            currentData = "";
          }
          // Ignore comments (lines starting with ':') and other fields
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        return;
      }
      console.error("[SSE] Stream read error:", err instanceof Error ? err.message : err);
    } finally {
      reader.releaseLock();
      this.connected = false;
      if (this.running) {
        this.scheduleReconnect();
      }
    }
  }

  private processSSEEvent(eventType: string, data: string): void {
    try {
      const parsed = JSON.parse(data);
      const globalEvent: GlobalEvent = {
        directory: parsed.directory,
        project: parsed.project,
        workspace: parsed.workspace,
        payload: {
          id: parsed.payload?.id || "",
          type: parsed.payload?.type || eventType,
          properties: parsed.payload?.properties || parsed,
        },
      };

      // Filter by directory if configured
      if (this.config.opencodeDirectory && globalEvent.directory) {
        if (globalEvent.directory !== this.config.opencodeDirectory) {
          return;
        }
      }

      for (const handler of this.handlers) {
        try {
          handler(globalEvent);
        } catch (err) {
          console.error("[SSE] Handler error:", err);
        }
      }
    } catch {
      // Skip invalid JSON events
      console.warn(`[SSE] Failed to parse event data:`, data.substring(0, 200));
    }
  }

  private scheduleReconnect(): void {
    if (!this.running) return;

    console.log(`[SSE] Reconnecting in ${this.reconnectDelay}ms...`);
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
      this.connect();
    }, this.reconnectDelay);
  }
}
