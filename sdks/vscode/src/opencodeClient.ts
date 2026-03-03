import * as vscode from "vscode";
import { SessionStorage, SessionMessage } from "./sessionStorage";

const MIN_PORT = 16384;
const MAX_PORT = 65535;
const HEALTH_RETRY_MS = 200;
const HEALTH_MAX_TRIES = 50;

export interface Session {
  id: string
}

export interface Client {
  port: number
  session: Session
}

interface SessionResponse {
  id: string
}

export interface MessageChunk {
  type: "content" | "done"
  content?: string
}

export interface SendMessageOptions {
  signal?: AbortSignal
}

export interface EventMessage {
  type: string
  data: unknown
}

interface ChatContextHistory {
  result?: {
    metadata?: {
      sessionId?: string
    }
  }
}

interface ChatContext {
  history?: ChatContextHistory[]
}

export async function createClient(): Promise<Client | undefined> {
  const port = allocatePort();
  const started = await startServer(port);
  if (!started) {
    return;
  }

  const healthy = await waitForHealth(port);
  if (!healthy) {
    return;
  }

  const session = await createSession(port);
  if (!session) {
    return;
  }

  return { port, session };
}

export async function getOrCreateSession(
  context: vscode.ExtensionContext,
  chatContext: ChatContext,
  storage: SessionStorage,
): Promise<Client | undefined> {
  const existingSessionId = extractSessionId(chatContext);

  if (existingSessionId) {
    const existingMapping = await storage.getSessionMapping(existingSessionId);
    if (existingMapping) {
      const client = await createClientWithExistingSession(existingSessionId, existingMapping);
      if (client) {
        return client;
      }
    }

    const restored = await restoreSession(existingSessionId, context, storage);
    if (restored) {
      return restored;
    }
  }

  const newClient = await createClient();
  if (!newClient) {
    return;
  }

  const title = generateSessionTitle();
  await storage.saveSession(newClient.session.id, title, []);
  await storage.saveSessionMapping(newClient.session.id, newClient.session.id);

  return newClient;
}

function extractSessionId(chatContext: ChatContext): string | undefined {
  if (!chatContext.history || chatContext.history.length === 0) {
    return;
  }

  const lastEntry = chatContext.history[chatContext.history.length - 1];
  if (!lastEntry.result?.metadata?.sessionId) {
    return;
  }

  return lastEntry.result.metadata.sessionId;
}

async function createClientWithExistingSession(sessionId: string, backendId: string): Promise<Client | undefined> {
  const port = allocatePort();
  const started = await startServer(port);
  if (!started) {
    return;
  }

  const healthy = await waitForHealth(port);
  if (!healthy) {
    return;
  }

  return { port, session: { id: backendId } };
}

async function restoreSession(
  sessionId: string,
  context: vscode.ExtensionContext,
  storage: SessionStorage,
): Promise<Client | undefined> {
  const sessionData = await storage.getSession(sessionId);
  if (!sessionData) {
    return;
  }

  const port = allocatePort();
  const started = await startServer(port);
  if (!started) {
    return;
  }

  const healthy = await waitForHealth(port);
  if (!healthy) {
    return;
  }

  const newSession = await createSession(port);
  if (!newSession) {
    return;
  }

  await storage.saveSessionMapping(sessionId, newSession.id);

  const messages = sessionData.transcript.messages;
  await storage.saveSession(sessionId, sessionData.metadata.title, messages);

  return { port, session: newSession };
}

function generateSessionTitle(): string {
  const now = new Date();
  const dateStr = now.toLocaleDateString();
  const timeStr = now.toLocaleTimeString();
  return `Chat ${dateStr} ${timeStr}`;
}

function allocatePort(): number {
  return Math.floor(Math.random() * (MAX_PORT - MIN_PORT + 1)) + MIN_PORT;
}

async function startServer(port: number): Promise<boolean> {
  const terminal = vscode.window.createTerminal({
    name: "opencode-server",
    hideFromUser: true,
  });

  terminal.sendText(`opencode serve --port ${port}`);

  return true;
}

async function waitForHealth(port: number): Promise<boolean> {
  let tries = HEALTH_MAX_TRIES;

  while (tries > 0) {
    await sleep(HEALTH_RETRY_MS);

    const healthy = await checkHealth(port);
    if (healthy) {
      return true;
    }

    tries--;
  }

  return false;
}

async function checkHealth(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://localhost:${port}/health`);
    return response.ok;
  } catch {
    return false;
  }
}

async function createSession(port: number): Promise<Session | undefined> {
  try {
    const response = await fetch(`http://localhost:${port}/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    if (!response.ok) {
      return;
    }

    const data = (await response.json()) as SessionResponse;
    if (!data.id) {
      return;
    }

    return { id: data.id };
  } catch {
    return;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function* sendMessage(
  port: number,
  sessionId: string,
  content: string,
  files: string[],
  options?: SendMessageOptions,
): AsyncGenerator<MessageChunk> {
  const controller = new AbortController();
  const signal = options?.signal;

  if (signal) {
    signal.addEventListener("abort", () => controller.abort());
  }

  const response = await fetch(`http://localhost:${port}/session/${sessionId}/message`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, files }),
    signal: controller.signal,
  });

  if (!response.body) {
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data: ")) {
        continue;
      }

      const json = trimmed.slice(6);
      if (json === "[DONE]") {
        yield { type: "done" };
        return;
      }

      const parsed = parseChunk(json);
      if (parsed) {
        yield parsed;
      }
    }
  }

  if (buffer.trim()) {
    const trimmed = buffer.trim();
    if (trimmed.startsWith("data: ")) {
      const json = trimmed.slice(6);
      const parsed = parseChunk(json);
      if (parsed) {
        yield parsed;
      }
    }
  }
}

function parseChunk(json: string): MessageChunk | undefined {
  try {
    const data = JSON.parse(json) as MessageChunk;
    if (data.type === "content" || data.type === "done") {
      return data;
    }
  } catch {
    // Invalid JSON, skip this chunk
  }
}

export async function* subscribeToEvents(port: number, sessionId: string): AsyncGenerator<EventMessage> {
  const response = await fetch(`http://localhost:${port}/event?sessionID=${sessionId}`);

  if (!response.body) {
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      const event = parseEvent(trimmed);
      if (event) {
        yield event;
      }
    }
  }

  if (buffer.trim()) {
    const event = parseEvent(buffer.trim());
    if (event) {
      yield event;
    }
  }
}

function parseEvent(line: string): EventMessage | undefined {
  if (line.startsWith("data: ")) {
    try {
      const json = line.slice(6);
      const data = JSON.parse(json) as EventMessage;
      return data;
    } catch {
      // Invalid JSON, skip this event
    }
  }
}

export async function persistMessage(
  storage: SessionStorage,
  sessionId: string,
  role: "user" | "assistant",
  content: string,
): Promise<void> {
  const session = await storage.getSession(sessionId);
  if (!session) {
    return;
  }

  const messages = session.transcript.messages;
  messages.push({
    role,
    content,
    timestamp: Date.now(),
  });

  await storage.saveSession(sessionId, session.metadata.title, messages);
}
