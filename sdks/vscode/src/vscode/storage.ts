import * as vscode from "vscode"

const SESSIONS_KEY = "opencode.sessions"
const INDEX_FILE = "index.json"
const TRANSCRIPTS_DIR = "transcripts"
const ATTACHMENTS_DIR = "attachments"
const STORAGE_VERSION = 1
const MAX_SESSIONS_DEFAULT = 50

export interface SessionMetadata {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  cwd: string
  acpSessionId?: string
}

export interface TranscriptMessage {
  role: "user" | "assistant" | "system"
  content: string
  metadata?: Record<string, unknown>
}

export interface Transcript {
  version: number
  sessionId: string
  messages: TranscriptMessage[]
  hasPendingEdits: boolean
}

interface SessionIndex {
  version: number
  sessions: SessionMetadata[]
}

export class StorageError extends Error {
  constructor(
    message: string,
    public cause?: Error,
  ) {
    super(message)
    this.name = "StorageError"
  }
}

export class OpenCodeStorage {
  private pendingWrites = new Set<Promise<void>>()
  private initialized = false

  constructor(
    private context: vscode.ExtensionContext,
    private fs: vscode.FileSystem = vscode.workspace.fs,
  ) {}

  async initialize(): Promise<void> {
    if (this.initialized) return

    const storageUri = this.storageUri
    if (!storageUri) throw new StorageError("Storage URI not available")

    await this.ensureDirectories()
    this.initialized = true
  }

  async saveSessionIndex(sessions: SessionMetadata[]): Promise<void> {
    if (!this.initialized) await this.initialize()

    const index: SessionIndex = {
      version: STORAGE_VERSION,
      sessions,
    }

    // Save to workspaceState (fast)
    await this.context.workspaceState.update(SESSIONS_KEY, index)

    // Save to file (durable backup)
    const indexUri = vscode.Uri.joinPath(this.storageUri, INDEX_FILE)
    const writePromise = this.atomicWrite(indexUri, Buffer.from(JSON.stringify(index, null, 2)))
    this.pendingWrites.add(writePromise)
    await writePromise
    this.pendingWrites.delete(writePromise)
  }

  async loadSessionIndex(): Promise<SessionMetadata[]> {
    if (!this.initialized) await this.initialize()

    // Try workspaceState first (fast)
    const fromState = this.context.workspaceState.get<SessionIndex>(SESSIONS_KEY)
    if (fromState?.sessions) {
      return fromState.sessions
    }

    // Fall back to index.json
    const indexUri = vscode.Uri.joinPath(this.storageUri, INDEX_FILE)

    try {
      const content = await this.fs.readFile(indexUri)
      const parsed: SessionIndex = JSON.parse(Buffer.from(content).toString())

      // Sync back to workspaceState
      await this.context.workspaceState.update(SESSIONS_KEY, parsed)

      return parsed.sessions ?? []
    } catch (error) {
      if (this.isFileNotFound(error)) {
        return []
      }
      throw new StorageError("Failed to load session index", error as Error)
    }
  }

  async saveTranscript(sessionId: string, transcript: Transcript): Promise<void> {
    if (!this.initialized) await this.initialize()
    if (!sessionId) throw new StorageError("Session ID is required")

    const transcriptUri = this.getTranscriptUri(sessionId)
    const data = Buffer.from(JSON.stringify(transcript, null, 2))

    const writePromise = this.atomicWrite(transcriptUri, data)
    this.pendingWrites.add(writePromise)

    try {
      await writePromise
    } catch (error) {
      throw new StorageError(`Failed to save transcript: ${sessionId}`, error as Error)
    } finally {
      this.pendingWrites.delete(writePromise)
    }
  }

  async loadTranscript(sessionId: string): Promise<Transcript> {
    if (!this.initialized) await this.initialize()
    if (!sessionId) throw new StorageError("Session ID is required")

    const transcriptUri = this.getTranscriptUri(sessionId)

    try {
      const content = await this.fs.readFile(transcriptUri)
      return JSON.parse(Buffer.from(content).toString()) as Transcript
    } catch (error) {
      if (this.isFileNotFound(error)) {
        throw new StorageError(`Transcript not found: ${sessionId}`)
      }
      throw new StorageError(`Failed to read transcript: ${sessionId}`, error as Error)
    }
  }

  async deleteTranscript(sessionId: string): Promise<void> {
    if (!this.initialized) await this.initialize()
    if (!sessionId) throw new StorageError("Session ID is required")

    const transcriptUri = this.getTranscriptUri(sessionId)

    try {
      await this.fs.delete(transcriptUri)
    } catch (error) {
      if (this.isFileNotFound(error)) {
        throw new StorageError(`Transcript not found: ${sessionId}`)
      }
      throw new StorageError(`Failed to delete transcript: ${sessionId}`, error as Error)
    }
  }

  async enforceMaxSessions(maxCount: number = MAX_SESSIONS_DEFAULT): Promise<void> {
    if (!this.initialized) await this.initialize()
    if (maxCount < 1) throw new StorageError("maxCount must be at least 1")

    const sessions = await this.loadSessionIndex()

    if (sessions.length <= maxCount) return

    // Sort by updatedAt ascending (oldest first)
    const sortedSessions = [...sessions].sort((a, b) => a.updatedAt - b.updatedAt)
    const sessionsToDelete = sortedSessions.slice(0, sessions.length - maxCount)
    const sessionsToKeep = sortedSessions.slice(sessions.length - maxCount)

    // Delete transcript files
    const deletePromises = sessionsToDelete.map((session) =>
      this.deleteTranscript(session.id).catch(() => {
        // Ignore errors for non-existent transcripts
      }),
    )

    await Promise.all(deletePromises)

    // Update index
    await this.saveSessionIndex(sessionsToKeep)
  }

  async flush(): Promise<void> {
    if (this.pendingWrites.size === 0) return

    await Promise.all(this.pendingWrites)
    this.pendingWrites.clear()
  }

  private get storageUri(): vscode.Uri {
    const uri = this.context.storageUri
    if (!uri) throw new StorageError("Extension storage not available")
    return uri
  }

  private async ensureDirectories(): Promise<void> {
    const storageUri = this.storageUri

    try {
      await this.fs.createDirectory(storageUri)
    } catch (error) {
      if (!this.isFileExists(error)) {
        throw new StorageError("Failed to create storage directory", error as Error)
      }
    }

    const transcriptsDir = vscode.Uri.joinPath(storageUri, TRANSCRIPTS_DIR)
    try {
      await this.fs.createDirectory(transcriptsDir)
    } catch (error) {
      if (!this.isFileExists(error)) {
        throw new StorageError("Failed to create transcripts directory", error as Error)
      }
    }

    const attachmentsDir = vscode.Uri.joinPath(storageUri, ATTACHMENTS_DIR)
    try {
      await this.fs.createDirectory(attachmentsDir)
    } catch (error) {
      if (!this.isFileExists(error)) {
        throw new StorageError("Failed to create attachments directory", error as Error)
      }
    }
  }

  private getTranscriptUri(sessionId: string): vscode.Uri {
    return vscode.Uri.joinPath(this.storageUri, TRANSCRIPTS_DIR, `${sessionId}.json`)
  }

  private async atomicWrite(uri: vscode.Uri, data: Buffer): Promise<void> {
    try {
      await this.fs.writeFile(uri, new Uint8Array(data))
    } catch (error) {
      throw error
    }
  }

  private isFileNotFound(error: unknown): boolean {
    if (error instanceof vscode.FileSystemError) {
      return error.code === "FileNotFound" || error.code === "ENOENT"
    }
    if (error instanceof Error) {
      return error.message.includes("ENOENT") || error.message.includes("no such file")
    }
    return false
  }

  private isFileExists(error: unknown): boolean {
    if (error instanceof vscode.FileSystemError) {
      return error.code === "FileExists" || error.code === "EEXIST"
    }
    if (error instanceof Error) {
      return error.message.includes("EEXIST") || error.message.includes("already exists")
    }
    return false
  }
}

export default OpenCodeStorage
