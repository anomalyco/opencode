import * as vscode from "vscode";
import * as path from "path";

const SESSION_METADATA_KEY = "opencode.sessions.metadata";
const SESSION_MAPPING_KEY_PREFIX = "opencode.session.mapping";

export interface SessionMetadata {
  id: string;
  title: string;
  updatedAt: number;
}

export interface SessionTranscript {
  id: string;
  messages: SessionMessage[];
}

export interface SessionMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

export interface SessionData {
  metadata: SessionMetadata;
  transcript: SessionTranscript;
}

export class SessionStorage {
  private context: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  private getWorkspaceKey(): string {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      return "no-workspace";
    }

    const keys = folders.map((f) => f.uri.toString()).sort();
    return keys.join("|");
  }

  private getMetadataKey(): string {
    const workspaceKey = this.getWorkspaceKey();
    return `${SESSION_METADATA_KEY}.${workspaceKey}`;
  }

  private getTranscriptUri(sessionId: string): vscode.Uri {
    const storageUri = this.context.storageUri || this.context.globalStorageUri;
    const transcriptsDir = path.join(storageUri.fsPath, "transcripts");
    const filePath = path.join(transcriptsDir, `${sessionId}.json`);
    return vscode.Uri.file(filePath);
  }

  private getMappingKey(sessionId: string): string {
    return `${SESSION_MAPPING_KEY_PREFIX}.${sessionId}`;
  }

  private async ensureTranscriptsDir(): Promise<void> {
    const storageUri = this.context.storageUri || this.context.globalStorageUri;
    const transcriptsDir = vscode.Uri.file(path.join(storageUri.fsPath, "transcripts"));
    await vscode.workspace.fs.createDirectory(transcriptsDir);
  }

  private parseMetadata(data: unknown): SessionMetadata[] {
    if (!Array.isArray(data)) {
      return [];
    }

    return data.filter((item): item is SessionMetadata => {
      if (!item || typeof item !== "object") {
        return false;
      }
      const meta = item as Record<string, unknown>;
      return (
        typeof meta.id === "string" &&
        typeof meta.title === "string" &&
        typeof meta.updatedAt === "number"
      );
    });
  }

  private parseTranscript(data: unknown): SessionTranscript | undefined {
    if (!data || typeof data !== "object") {
      return;
    }

    const transcript = data as Record<string, unknown>;
    if (typeof transcript.id !== "string" || !Array.isArray(transcript.messages)) {
      return;
    }

    const messages = transcript.messages.filter((msg): msg is SessionMessage => {
      if (!msg || typeof msg !== "object") {
        return false;
      }
      const message = msg as Record<string, unknown>;
      return (
        (message.role === "user" || message.role === "assistant") &&
        typeof message.content === "string" &&
        typeof message.timestamp === "number"
      );
    });

    return {
      id: transcript.id,
      messages,
    };
  }

  async saveSession(sessionId: string, title: string, messages: SessionMessage[]): Promise<void> {
    if (!sessionId) {
      return;
    }

    await this.ensureTranscriptsDir();

    const metadataKey = this.getMetadataKey();
    const existingData = this.context.workspaceState.get<unknown>(metadataKey);
    const sessions = this.parseMetadata(existingData);

    const existingIndex = sessions.findIndex((s) => s.id === sessionId);
    const now = Date.now();

    if (existingIndex >= 0) {
      sessions[existingIndex] = { id: sessionId, title, updatedAt: now };
    } else {
      sessions.push({ id: sessionId, title, updatedAt: now });
    }

    await this.context.workspaceState.update(metadataKey, sessions);

    const transcriptUri = this.getTranscriptUri(sessionId);
    const transcript: SessionTranscript = { id: sessionId, messages };
    const content = JSON.stringify(transcript, null, 2);
    const encoded = new TextEncoder().encode(content);
    await vscode.workspace.fs.writeFile(transcriptUri, encoded);
  }

  async getSession(sessionId: string): Promise<SessionData | undefined> {
    if (!sessionId) {
      return;
    }

    const metadataKey = this.getMetadataKey();
    const existingData = this.context.workspaceState.get<unknown>(metadataKey);
    const sessions = this.parseMetadata(existingData);

    const metadata = sessions.find((s) => s.id === sessionId);
    if (!metadata) {
      return;
    }

    const transcriptUri = this.getTranscriptUri(sessionId);
    const fileExists = await this.fileExists(transcriptUri);
    if (!fileExists) {
      return;
    }

    const bytes = await vscode.workspace.fs.readFile(transcriptUri);
    const content = new TextDecoder().decode(bytes);

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      return;
    }

    const transcript = this.parseTranscript(parsed);
    if (!transcript) {
      return;
    }

    return { metadata, transcript };
  }

  async listSessions(): Promise<SessionMetadata[]> {
    const metadataKey = this.getMetadataKey();
    const existingData = this.context.workspaceState.get<unknown>(metadataKey);
    const sessions = this.parseMetadata(existingData);

    return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async deleteSession(sessionId: string): Promise<void> {
    if (!sessionId) {
      return;
    }

    const metadataKey = this.getMetadataKey();
    const existingData = this.context.workspaceState.get<unknown>(metadataKey);
    const sessions = this.parseMetadata(existingData);

    const filtered = sessions.filter((s) => s.id !== sessionId);
    await this.context.workspaceState.update(metadataKey, filtered);

    const transcriptUri = this.getTranscriptUri(sessionId);
    const fileExists = await this.fileExists(transcriptUri);
    if (fileExists) {
      await vscode.workspace.fs.delete(transcriptUri);
    }
  }

  async updateSessionTitle(sessionId: string, title: string): Promise<void> {
    if (!sessionId) {
      return;
    }

    const metadataKey = this.getMetadataKey();
    const existingData = this.context.workspaceState.get<unknown>(metadataKey);
    const sessions = this.parseMetadata(existingData);

    const session = sessions.find((s) => s.id === sessionId);
    if (!session) {
      return;
    }

    session.title = title;
    session.updatedAt = Date.now();

    await this.context.workspaceState.update(metadataKey, sessions);
  }

  async saveSessionMapping(sessionId: string, backendId: string): Promise<void> {
    if (!sessionId || !backendId) {
      return;
    }

    const mappingKey = this.getMappingKey(sessionId);
    await this.context.globalState.update(mappingKey, backendId);

    const keys = this.context.globalState.keys();
    const mappingKeys = keys.filter((k) => k.startsWith(SESSION_MAPPING_KEY_PREFIX));
    this.context.globalState.setKeysForSync(mappingKeys);
  }

  async getSessionMapping(sessionId: string): Promise<string | undefined> {
    if (!sessionId) {
      return;
    }

    const mappingKey = this.getMappingKey(sessionId);
    const mapping = this.context.globalState.get<unknown>(mappingKey);

    if (typeof mapping !== "string") {
      return;
    }

    return mapping;
  }

  private async fileExists(uri: vscode.Uri): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(uri);
      return true;
    } catch {
      return false;
    }
  }
}
