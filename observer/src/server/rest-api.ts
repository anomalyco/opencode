import type { Router, Request, Response } from "express";
import type { StateManager } from "./state-manager.js";
import type { Config } from "./config.js";
import type { OpenCodeSSEClient } from "./sse-client.js";

interface SessionWithStatus {
  id: string;
  title: string;
  agent?: string;
  model?: { id: string; providerID: string; variant?: string };
  cost?: number;
  tokens?: { input: number; output: number; reasoning: number; cache: { read: number; write: number } };
  time: { created: number; updated: number; archived?: number };
  parentID?: string;
  directory?: string;
  share?: { url: string };
  status: { type: string };
}

export function createRestApi(
  router: Router,
  config: Config,
  stateManager: StateManager,
  sseClient: OpenCodeSSEClient
): void {
  // GET /api/sessions - list all sessions with status
  router.get("/api/sessions", (_req: Request, res: Response) => {
    try {
      const sessions = stateManager.getSessions();
      const sessionsWithStatus: SessionWithStatus[] = sessions.map((session) => ({
        ...session,
        status: stateManager.getSessionStatus(session.id),
      }));
      res.json(sessionsWithStatus);
    } catch (err) {
      console.error("[REST] Error fetching sessions:", err);
      res.status(500).json({ error: "Failed to fetch sessions" });
    }
  });

  // GET /api/sessions/:id - get session detail
  router.get("/api/sessions/:id", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const session = stateManager.getSession(id);

      if (!session) {
        // Try proxying to opencode API
        const proxied = await proxyGet(
          `${config.opencodeUrl}/session/${id}`,
          config
        );
        if (proxied) {
          res.json(proxied);
          return;
        }
        res.status(404).json({ error: "Session not found" });
        return;
      }

      const status = stateManager.getSessionStatus(id);
      res.json({ ...session, status });
    } catch (err) {
      console.error("[REST] Error fetching session:", err);
      res.status(500).json({ error: "Failed to fetch session" });
    }
  });

  // GET /api/sessions/:id/messages - get session messages
  router.get("/api/sessions/:id/messages", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      let messages = stateManager.getMessages(id);

      // If no cached messages, try fetching from opencode API
      if (messages.length === 0) {
        messages = await stateManager.fetchMessages(id);
      }

      // If still empty, try proxying directly
      if (messages.length === 0) {
        const proxied = await proxyGet(
          `${config.opencodeUrl}/session/${id}/message`,
          config
        );
        if (proxied) {
          res.json(proxied);
          return;
        }
      }

      res.json(messages);
    } catch (err) {
      console.error("[REST] Error fetching messages:", err);
      res.status(500).json({ error: "Failed to fetch messages" });
    }
  });

  // GET /api/status - observer service status
  router.get("/api/status", (_req: Request, res: Response) => {
    res.json({
      status: "running",
      opencode: {
        url: config.opencodeUrl,
        connected: sseClient.isConnected(),
        directory: config.opencodeDirectory || null,
      },
      uptime: process.uptime(),
      timestamp: Date.now(),
    });
  });
}

async function proxyGet(url: string, config: Config): Promise<unknown | null> {
  try {
    const headers: Record<string, string> = {};
    if (config.opencodeDirectory) {
      headers["x-opencode-directory"] = config.opencodeDirectory;
    }
    if (config.opencodePassword) {
      headers["Authorization"] = `Bearer ${config.opencodePassword}`;
    }

    const response = await fetch(url, { headers });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}
