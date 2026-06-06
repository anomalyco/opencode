import type {
  SessionInfo,
  SessionStatus,
  Message,
  AssistantMessage,
  Part,
  TextPart,
  ReasoningPart,
  ToolPart,
  MessageWithParts,
  GlobalEvent,
  ServerMessage,
} from "../shared/types.js";
import type { Config } from "./config.js";

export type StateChangeHandler = (messages: ServerMessage[]) => void;

export class StateManager {
  private config: Config;
  private sessions = new Map<string, SessionInfo>();
  private sessionStatus = new Map<string, SessionStatus>();
  private messages = new Map<string, Map<string, MessageWithParts>>();
  private handlers: StateChangeHandler[] = [];

  constructor(config: Config) {
    this.config = config;
  }

  onChange(handler: StateChangeHandler): () => void {
    this.handlers.push(handler);
    return () => {
      this.handlers = this.handlers.filter((h) => h !== handler);
    };
  }

  private emit(messages: ServerMessage[]): void {
    for (const handler of this.handlers) {
      try {
        handler(messages);
      } catch (err) {
        console.error("[State] Handler error:", err);
      }
    }
  }

  // --- Query methods ---

  getSessions(): SessionInfo[] {
    return Array.from(this.sessions.values()).sort(
      (a, b) => b.time.updated - a.time.updated
    );
  }

  getSession(id: string): SessionInfo | undefined {
    return this.sessions.get(id);
  }

  getSessionStatus(id: string): SessionStatus {
    return this.sessionStatus.get(id) || { type: "idle" };
  }

  getMessages(sessionID: string): MessageWithParts[] {
    const msgMap = this.messages.get(sessionID);
    if (!msgMap) return [];
    return Array.from(msgMap.values()).sort((a, b) => {
      const aTime = a.info.time.created;
      const bTime = b.info.time.created;
      return aTime - bTime;
    });
  }

  getMessage(sessionID: string, messageID: string): MessageWithParts | undefined {
    return this.messages.get(sessionID)?.get(messageID);
  }

  // --- Initial data loading ---

  async loadInitialData(): Promise<void> {
    await Promise.all([
      this.fetchSessions(),
      this.fetchSessionStatuses(),
    ]);
  }

  private async fetchSessions(): Promise<void> {
    try {
      const headers: Record<string, string> = {};
      if (this.config.opencodeDirectory) {
        headers["x-opencode-directory"] = this.config.opencodeDirectory;
      }
      if (this.config.opencodePassword) {
        headers["Authorization"] = `Bearer ${this.config.opencodePassword}`;
      }

      const response = await fetch(`${this.config.opencodeUrl}/session`, { headers });
      if (!response.ok) {
        console.error(`[State] Failed to fetch sessions: ${response.status}`);
        return;
      }

      const data = await response.json();
      const sessions: SessionInfo[] = Array.isArray(data) ? data : [];

      for (const session of sessions) {
        this.sessions.set(session.id, session);
      }

      console.log(`[State] Loaded ${sessions.length} sessions`);
    } catch (err) {
      console.error("[State] Failed to fetch sessions:", err instanceof Error ? err.message : err);
    }
  }

  private async fetchSessionStatuses(): Promise<void> {
    try {
      const headers: Record<string, string> = {};
      if (this.config.opencodeDirectory) {
        headers["x-opencode-directory"] = this.config.opencodeDirectory;
      }
      if (this.config.opencodePassword) {
        headers["Authorization"] = `Bearer ${this.config.opencodePassword}`;
      }

      const response = await fetch(`${this.config.opencodeUrl}/session/status`, { headers });
      if (!response.ok) {
        console.error(`[State] Failed to fetch session statuses: ${response.status}`);
        return;
      }

      const data = await response.json();
      if (data && typeof data === "object") {
        for (const [id, status] of Object.entries(data)) {
          this.sessionStatus.set(id, status as SessionStatus);
        }
      }

      console.log(`[State] Loaded statuses for ${this.sessionStatus.size} sessions`);
    } catch (err) {
      console.error("[State] Failed to fetch session statuses:", err instanceof Error ? err.message : err);
    }
  }

  async fetchMessages(sessionID: string): Promise<MessageWithParts[]> {
    try {
      const headers: Record<string, string> = {};
      if (this.config.opencodeDirectory) {
        headers["x-opencode-directory"] = this.config.opencodeDirectory;
      }
      if (this.config.opencodePassword) {
        headers["Authorization"] = `Bearer ${this.config.opencodePassword}`;
      }

      const response = await fetch(
        `${this.config.opencodeUrl}/session/${sessionID}/message`,
        { headers }
      );
      if (!response.ok) {
        console.error(`[State] Failed to fetch messages for ${sessionID}: ${response.status}`);
        return [];
      }

      const data = await response.json();
      const rawMessages: Array<{ info: Message; parts: Part[] }> = Array.isArray(data) ? data : [];

      if (!this.messages.has(sessionID)) {
        this.messages.set(sessionID, new Map());
      }
      const msgMap = this.messages.get(sessionID)!;

      for (const msg of rawMessages) {
        msgMap.set(msg.info.id, {
          info: msg.info,
          parts: msg.parts || [],
        });
      }

      return this.getMessages(sessionID);
    } catch (err) {
      console.error(`[State] Failed to fetch messages for ${sessionID}:`, err instanceof Error ? err.message : err);
      return [];
    }
  }

  // --- SSE event processing ---

  processEvent(event: GlobalEvent): void {
    const { payload } = event;
    const eventType = payload.type;
    const props = payload.properties;

    switch (eventType) {
      case "session.created":
        this.handleSessionCreated(props);
        break;
      case "session.updated":
        this.handleSessionUpdated(props);
        break;
      case "session.deleted":
        this.handleSessionDeleted(props);
        break;
      case "session.status":
        this.handleSessionStatus(props);
        break;
      case "message.updated":
        this.handleMessageUpdated(props);
        break;
      case "message.part.updated":
        this.handlePartUpdated(props);
        break;
      case "session.next.text.delta":
        this.handleTextDelta(props);
        break;
      case "session.next.reasoning.delta":
        this.handleReasoningDelta(props);
        break;
      case "session.next.tool.called":
        this.handleToolCalled(props);
        break;
      case "session.next.tool.progress":
        this.handleToolProgress(props);
        break;
      case "session.next.tool.success":
        this.handleToolSuccess(props);
        break;
      case "session.next.tool.failed":
        this.handleToolFailed(props);
        break;
      case "session.next.step.started":
        this.handleStepStarted(props);
        break;
      case "session.next.step.ended":
        this.handleStepEnded(props);
        break;
      case "session.next.text.started":
        this.handleTextStarted(props);
        break;
      case "session.next.text.ended":
        this.handleTextEnded(props);
        break;
      case "session.next.reasoning.started":
        this.handleReasoningStarted(props);
        break;
      case "session.next.reasoning.ended":
        this.handleReasoningEnded(props);
        break;
      case "session.next.prompted":
        this.handlePrompted(props);
        break;
      default:
        // Ignore unknown event types
        break;
    }
  }

  private handleSessionCreated(props: Record<string, unknown>): void {
    const session = props as unknown as SessionInfo;
    if (!session.id) return;

    this.sessions.set(session.id, session);
    this.emit([{ type: "session.created", session }]);
  }

  private handleSessionUpdated(props: Record<string, unknown>): void {
    const session = props as unknown as SessionInfo;
    if (!session.id) return;

    this.sessions.set(session.id, session);
    this.emit([{ type: "session.updated", session }]);
  }

  private handleSessionDeleted(props: Record<string, unknown>): void {
    const sessionID = (props as { id?: string }).id;
    if (!sessionID) return;

    this.sessions.delete(sessionID);
    this.sessionStatus.delete(sessionID);
    this.messages.delete(sessionID);
    this.emit([{ type: "session.deleted", sessionID }]);
  }

  private handleSessionStatus(props: Record<string, unknown>): void {
    const sessionID = (props as { sessionID?: string; id?: string }).sessionID
      || (props as { sessionID?: string; id?: string }).id;
    if (!sessionID) return;

    const status = props as unknown as SessionStatus;
    this.sessionStatus.set(sessionID, status);
    this.emit([{ type: "session.status", sessionID, status }]);
  }

  private handleMessageUpdated(props: Record<string, unknown>): void {
    const msg = props as unknown as Message;
    if (!msg.id || !msg.sessionID) return;

    const sessionID = msg.sessionID;
    if (!this.messages.has(sessionID)) {
      this.messages.set(sessionID, new Map());
    }
    const msgMap = this.messages.get(sessionID)!;

    const existing = msgMap.get(msg.id);
    const parts = existing?.parts || [];

    const messageWithParts: MessageWithParts = {
      info: msg,
      parts,
    };
    msgMap.set(msg.id, messageWithParts);

    this.emit([{ type: "message.updated", sessionID, message: messageWithParts }]);
  }

  private handlePartUpdated(props: Record<string, unknown>): void {
    const part = props as unknown as Part;
    if (!part.id || !part.sessionID || !part.messageID) return;

    const sessionID = part.sessionID;
    const messageID = part.messageID;

    if (!this.messages.has(sessionID)) {
      this.messages.set(sessionID, new Map());
    }
    const msgMap = this.messages.get(sessionID)!;

    const existing = msgMap.get(messageID);
    if (existing) {
      const partIndex = existing.parts.findIndex((p) => p.id === part.id);
      if (partIndex >= 0) {
        existing.parts[partIndex] = part;
      } else {
        existing.parts.push(part);
      }
    } else {
      // Create a placeholder message entry if it doesn't exist yet
      msgMap.set(messageID, {
        info: {
          id: messageID,
          sessionID,
          role: "assistant",
          time: { created: Date.now() },
          agent: "",
          modelID: "",
          providerID: "",
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        } as AssistantMessage,
        parts: [part],
      });
    }

    this.emit([{ type: "part.updated", sessionID, part }]);
  }

  private handleTextDelta(props: Record<string, unknown>): void {
    const sessionID = (props as { sessionID?: string }).sessionID;
    const messageID = (props as { messageID?: string }).messageID;
    const partID = (props as { partID?: string }).partID;
    const delta = (props as { delta?: string }).delta;

    if (!sessionID || !messageID || !partID || delta === undefined) return;

    // Accumulate delta into the text part
    if (this.messages.has(sessionID)) {
      const msgMap = this.messages.get(sessionID)!;
      const msg = msgMap.get(messageID);
      if (msg) {
        const part = msg.parts.find((p) => p.id === partID);
        if (part && part.type === "text") {
          (part as TextPart).text += delta;
        }
      }
    }

    this.emit([{ type: "text.delta", sessionID, messageID, partID, delta }]);
  }

  private handleReasoningDelta(props: Record<string, unknown>): void {
    const sessionID = (props as { sessionID?: string }).sessionID;
    const messageID = (props as { messageID?: string }).messageID;
    const partID = (props as { partID?: string }).partID;
    const delta = (props as { delta?: string }).delta;

    if (!sessionID || !messageID || !partID || delta === undefined) return;

    // Accumulate delta into the reasoning part
    if (this.messages.has(sessionID)) {
      const msgMap = this.messages.get(sessionID)!;
      const msg = msgMap.get(messageID);
      if (msg) {
        const part = msg.parts.find((p) => p.id === partID);
        if (part && part.type === "reasoning") {
          (part as ReasoningPart).text += delta;
        }
      }
    }

    this.emit([{ type: "reasoning.delta", sessionID, messageID, partID, delta }]);
  }

  private handleToolCalled(props: Record<string, unknown>): void {
    const sessionID = (props as { sessionID?: string }).sessionID;
    const messageID = (props as { messageID?: string }).messageID;
    if (!sessionID || !messageID) return;

    const toolPart = this.extractToolPart(props);
    if (!toolPart) return;

    this.upsertPart(sessionID, messageID, toolPart);
    this.emit([{ type: "tool.progress", sessionID, part: toolPart }]);
  }

  private handleToolProgress(props: Record<string, unknown>): void {
    const sessionID = (props as { sessionID?: string }).sessionID;
    const messageID = (props as { messageID?: string }).messageID;
    if (!sessionID || !messageID) return;

    const toolPart = this.extractToolPart(props);
    if (!toolPart) return;

    this.upsertPart(sessionID, messageID, toolPart);
    this.emit([{ type: "tool.progress", sessionID, part: toolPart }]);
  }

  private handleToolSuccess(props: Record<string, unknown>): void {
    const sessionID = (props as { sessionID?: string }).sessionID;
    const messageID = (props as { messageID?: string }).messageID;
    if (!sessionID || !messageID) return;

    const toolPart = this.extractToolPart(props);
    if (!toolPart) return;

    this.upsertPart(sessionID, messageID, toolPart);
    this.emit([{ type: "tool.progress", sessionID, part: toolPart }]);
  }

  private handleToolFailed(props: Record<string, unknown>): void {
    const sessionID = (props as { sessionID?: string }).sessionID;
    const messageID = (props as { messageID?: string }).messageID;
    if (!sessionID || !messageID) return;

    const toolPart = this.extractToolPart(props);
    if (!toolPart) return;

    this.upsertPart(sessionID, messageID, toolPart);
    this.emit([{ type: "tool.progress", sessionID, part: toolPart }]);
  }

  private handleStepStarted(props: Record<string, unknown>): void {
    const sessionID = (props as { sessionID?: string }).sessionID;
    if (!sessionID) return;

    const assistantMessageID = (props as { assistantMessageID?: string }).assistantMessageID
      || (props as { messageID?: string }).messageID
      || "";
    const agent = (props as { agent?: string }).agent || "";
    const model = (props as { model?: { id: string; providerID: string } }).model
      || { id: "", providerID: "" };

    this.emit([{
      type: "step.started",
      sessionID,
      data: { assistantMessageID, agent, model },
    }]);
  }

  private handleStepEnded(props: Record<string, unknown>): void {
    const sessionID = (props as { sessionID?: string }).sessionID;
    if (!sessionID) return;

    const assistantMessageID = (props as { assistantMessageID?: string }).assistantMessageID
      || (props as { messageID?: string }).messageID
      || "";
    const cost = (props as { cost?: number }).cost || 0;
    const tokens = (props as { tokens?: { input: number; output: number; reasoning: number; cache: { read: number; write: number } } }).tokens
      || { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } };

    this.emit([{
      type: "step.ended",
      sessionID,
      data: { assistantMessageID, cost, tokens },
    }]);
  }

  private handleTextStarted(props: Record<string, unknown>): void {
    // Text started event - may contain initial part info
    const sessionID = (props as { sessionID?: string }).sessionID;
    const messageID = (props as { messageID?: string }).messageID;
    const partID = (props as { partID?: string }).partID;

    if (!sessionID || !messageID || !partID) return;

    // Create a text part placeholder if it doesn't exist
    const textPart: TextPart = {
      id: partID,
      sessionID,
      messageID,
      type: "text",
      text: "",
      time: { start: Date.now() },
    };

    this.upsertPart(sessionID, messageID, textPart);
  }

  private handleTextEnded(props: Record<string, unknown>): void {
    // Text ended - update the part if we have it
    const part = props as unknown as Part;
    if (part.id && part.sessionID && part.messageID) {
      this.upsertPart(part.sessionID, part.messageID, part);
    }
  }

  private handleReasoningStarted(props: Record<string, unknown>): void {
    const sessionID = (props as { sessionID?: string }).sessionID;
    const messageID = (props as { messageID?: string }).messageID;
    const partID = (props as { partID?: string }).partID;

    if (!sessionID || !messageID || !partID) return;

    const reasoningPart: ReasoningPart = {
      id: partID,
      sessionID,
      messageID,
      type: "reasoning",
      text: "",
      time: { start: Date.now() },
    };

    this.upsertPart(sessionID, messageID, reasoningPart);
  }

  private handleReasoningEnded(props: Record<string, unknown>): void {
    const part = props as unknown as Part;
    if (part.id && part.sessionID && part.messageID) {
      this.upsertPart(part.sessionID, part.messageID, part);
    }
  }

  private handlePrompted(props: Record<string, unknown>): void {
    // User sent a message - the message.updated event will handle the actual data
    // This is just a signal that a prompt was sent
  }

  // --- Helper methods ---

  private extractToolPart(props: Record<string, unknown>): ToolPart | null {
    const id = (props as { id?: string; partID?: string }).id
      || (props as { id?: string; partID?: string }).partID;
    const sessionID = (props as { sessionID?: string }).sessionID;
    const messageID = (props as { messageID?: string }).messageID;
    const callID = (props as { callID?: string }).callID || id || "";
    const tool = (props as { tool?: string; name?: string }).tool
      || (props as { tool?: string; name?: string }).name || "";

    if (!id || !sessionID || !messageID) return null;

    // Extract tool state from the event properties
    const state = this.extractToolState(props);

    return {
      id,
      sessionID,
      messageID,
      type: "tool",
      callID,
      tool,
      state,
    };
  }

  private extractToolState(props: Record<string, unknown>): ToolPart["state"] {
    const status = (props as { status?: string }).status;
    const input = (props as { input?: Record<string, unknown> }).input || {};
    const raw = (props as { raw?: string }).raw || JSON.stringify(input);

    switch (status) {
      case "running": {
        const title = (props as { title?: string }).title;
        const startTime = (props as { time?: { start: number } }).time?.start || Date.now();
        return { status: "running", input, title, time: { start: startTime } };
      }
      case "completed": {
        const output = (props as { output?: string }).output || "";
        const title = (props as { title?: string }).title || "";
        const time = (props as { time?: { start: number; end: number } }).time
          || { start: Date.now(), end: Date.now() };
        return { status: "completed", input, output, title, time };
      }
      case "error": {
        const error = (props as { error?: string }).error || "Unknown error";
        const time = (props as { time?: { start: number; end: number } }).time
          || { start: Date.now(), end: Date.now() };
        return { status: "error", input, error, time };
      }
      default:
        return { status: "pending", input, raw };
    }
  }

  private upsertPart(sessionID: string, messageID: string, part: Part): void {
    if (!this.messages.has(sessionID)) {
      this.messages.set(sessionID, new Map());
    }
    const msgMap = this.messages.get(sessionID)!;

    const existing = msgMap.get(messageID);
    if (existing) {
      const partIndex = existing.parts.findIndex((p) => p.id === part.id);
      if (partIndex >= 0) {
        existing.parts[partIndex] = part;
      } else {
        existing.parts.push(part);
      }
    } else {
      // Create a placeholder message entry
      msgMap.set(messageID, {
        info: {
          id: messageID,
          sessionID,
          role: "assistant",
          time: { created: Date.now() },
          agent: "",
          modelID: "",
          providerID: "",
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        } as AssistantMessage,
        parts: [part],
      });
    }
  }
}
