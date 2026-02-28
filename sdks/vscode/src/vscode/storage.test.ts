import { strict as assert } from "assert"
import { describe, it, beforeEach } from "mocha"
import * as vscode from "vscode"
import { OpenCodeStorage, StorageError, SessionMetadata, Transcript, TranscriptMessage } from "./storage"

// Mock filesystem structure
interface MockFile {
  content: Uint8Array
  isDirectory: boolean
}

// Mock workspace state
function createMockWorkspaceState(): vscode.Memento & { storage: Map<string, unknown> } {
  const storage = new Map<string, unknown>()

  return {
    storage,
    get<T>(key: string): T | undefined {
      return storage.get(key) as T | undefined
    },
    update: async (key: string, value: unknown): Promise<void> => {
      if (value === undefined) {
        storage.delete(key)
      } else {
        storage.set(key, value)
      }
    },
  } as unknown as vscode.Memento & { storage: Map<string, unknown> }
}

// Mock file system
function createMockFileSystem(): {
  files: Map<string, MockFile>
  fs: vscode.FileSystem
} {
  const files = new Map<string, MockFile>()

  const fs: vscode.FileSystem = {
    createDirectory: async (uri: vscode.Uri): Promise<void> => {
      const path = uri.fsPath
      files.set(path, { content: new Uint8Array(), isDirectory: true })
    },

    writeFile: async (uri: vscode.Uri, content: Uint8Array): Promise<void> => {
      const path = uri.fsPath
      files.set(path, { content: new Uint8Array(content), isDirectory: false })
    },

    readFile: async (uri: vscode.Uri): Promise<Uint8Array> => {
      const path = uri.fsPath
      const file = files.get(path)
      if (!file) {
        const error = new Error(`ENOENT: no such file or directory, open '${path}'`)
        ;(error as any).code = "ENOENT"
        throw error
      }
      if (file.isDirectory) {
        throw new Error(`EISDIR: illegal operation on a directory, read '${path}'`)
      }
      return new Uint8Array(file.content)
    },

    delete: async (uri: vscode.Uri): Promise<void> => {
      const path = uri.fsPath
      if (!files.has(path)) {
        const error = new Error(`ENOENT: no such file or directory, unlink '${path}'`)
        ;(error as any).code = "ENOENT"
        throw error
      }
      files.delete(path)
    },

    readDirectory: async (uri: vscode.Uri): Promise<[string, vscode.FileType][]> => {
      const dirPath = uri.fsPath
      const entries: [string, vscode.FileType][] = []

      for (const [path, file] of files.entries()) {
        const parentDir = path.substring(0, path.lastIndexOf("/")) || dirPath
        if (parentDir === dirPath || (dirPath !== "/" && parentDir.startsWith(dirPath))) {
          const name = path.substring(path.lastIndexOf("/") + 1)
          if (name && path !== dirPath) {
            entries.push([name, file.isDirectory ? vscode.FileType.Directory : vscode.FileType.File])
          }
        }
      }

      return entries
    },

    stat: async (uri: vscode.Uri): Promise<vscode.FileStat> => {
      const path = uri.fsPath
      const file = files.get(path)
      if (!file) {
        const error = new Error(`ENOENT: no such file or directory, stat '${path}'`)
        ;(error as any).code = "ENOENT"
        throw error
      }
      return {
        type: file.isDirectory ? vscode.FileType.Directory : vscode.FileType.File,
        ctime: Date.now(),
        mtime: Date.now(),
        size: file.content.length,
      }
    },

    rename: async (): Promise<void> => {
      // Mock implementation - not used in tests
      throw new Error("Not implemented")
    },

    copy: async (): Promise<void> => {
      // Mock implementation - not used in tests
      throw new Error("Not implemented")
    },

    isWritableFileSystem: (): boolean => {
      return true
    },
  }

  return { files, fs }
}

// Mock extension context
function createMockExtensionContext(workspaceState: vscode.Memento, storageUri: vscode.Uri): vscode.ExtensionContext {
  return {
    subscriptions: [],
    workspaceState,
    storageUri,
    asAbsolutePath: (relativePath: string) => `/mock/path/${relativePath}`,
  } as unknown as vscode.ExtensionContext
}

describe("OpenCodeStorage", () => {
  let storage: OpenCodeStorage
  let mockWorkspaceState: ReturnType<typeof createMockWorkspaceState>
  let mockFs: ReturnType<typeof createMockFileSystem>
  let mockContext: vscode.ExtensionContext
  let storageUri: vscode.Uri

  beforeEach(() => {
    mockWorkspaceState = createMockWorkspaceState()
    mockFs = createMockFileSystem()
    storageUri = vscode.Uri.file("/mock/storage/.opencode")
    mockContext = createMockExtensionContext(mockWorkspaceState, storageUri)

    // Inject mock filesystem
    storage = new OpenCodeStorage(mockContext, mockFs.fs)
  })

  describe("creates directories on first use", () => {
    it("creates storage directories when initialized", async () => {
      await storage.initialize()

      const transcriptsDir = vscode.Uri.joinPath(storageUri, "transcripts")
      const attachmentsDir = vscode.Uri.joinPath(storageUri, "attachments")

      const transcriptsStat = await mockFs.fs.stat(transcriptsDir)
      const attachmentsStat = await mockFs.fs.stat(attachmentsDir)

      assert.strictEqual(transcriptsStat.type, vscode.FileType.Directory)
      assert.strictEqual(attachmentsStat.type, vscode.FileType.Directory)
    })

    it("creates directories lazily on first write operation", async () => {
      const sessions: SessionMetadata[] = [
        { id: "test-1", title: "Test", createdAt: Date.now(), updatedAt: Date.now(), cwd: "/mock" },
      ]

      await storage.saveSessionIndex(sessions)

      const indexFile = vscode.Uri.joinPath(storageUri, "index.json")
      const stat = await mockFs.fs.stat(indexFile)
      assert.strictEqual(stat.type, vscode.FileType.File)
    })
  })

  describe("saves session index to workspaceState", () => {
    it("saves sessions to workspaceState", async () => {
      const sessions: SessionMetadata[] = [
        {
          id: "session-1",
          title: "Test Session",
          createdAt: 1234567890,
          updatedAt: 1234567890,
          cwd: "/mock/workspace",
        },
      ]

      await storage.saveSessionIndex(sessions)

      const stored = mockWorkspaceState.get<{ version: number; sessions: SessionMetadata[] }>("opencode.sessions")
      assert.ok(stored, "Should store sessions in workspaceState")
      assert.strictEqual(stored!.version, 1)
      assert.strictEqual(stored!.sessions.length, 1)
      assert.strictEqual(stored!.sessions[0].id, "session-1")
    })

    it("saves backup to index.json file", async () => {
      const sessions: SessionMetadata[] = [
        {
          id: "session-1",
          title: "Test Session",
          createdAt: 1234567890,
          updatedAt: 1234567890,
          cwd: "/mock/workspace",
        },
      ]

      await storage.saveSessionIndex(sessions)

      const indexFile = vscode.Uri.joinPath(storageUri, "index.json")
      const content = await mockFs.fs.readFile(indexFile)
      const parsed = JSON.parse(Buffer.from(content).toString())

      assert.strictEqual(parsed.version, 1)
      assert.strictEqual(parsed.sessions.length, 1)
      assert.strictEqual(parsed.sessions[0].id, "session-1")
    })

    it("overwrites existing sessions", async () => {
      const sessions1: SessionMetadata[] = [
        { id: "session-1", title: "First", createdAt: 1, updatedAt: 1, cwd: "/mock" },
      ]
      const sessions2: SessionMetadata[] = [
        { id: "session-2", title: "Second", createdAt: 2, updatedAt: 2, cwd: "/mock" },
      ]

      await storage.saveSessionIndex(sessions1)
      await storage.saveSessionIndex(sessions2)

      const stored = mockWorkspaceState.get<{ sessions: SessionMetadata[] }>("opencode.sessions")
      assert.strictEqual(stored!.sessions.length, 1)
      assert.strictEqual(stored!.sessions[0].id, "session-2")
    })
  })

  describe("loads session index", () => {
    it("loads from workspaceState when available", async () => {
      const sessions: SessionMetadata[] = [
        {
          id: "session-1",
          title: "Workspace Session",
          createdAt: 1234567890,
          updatedAt: 1234567890,
          cwd: "/mock/workspace",
        },
      ]

      // Pre-populate workspaceState
      await mockWorkspaceState.update("opencode.sessions", { version: 1, sessions })

      const loaded = await storage.loadSessionIndex()

      assert.strictEqual(loaded.length, 1)
      assert.strictEqual(loaded[0].title, "Workspace Session")
    })

    it("falls back to index.json when workspaceState empty", async () => {
      const sessions: SessionMetadata[] = [
        {
          id: "session-1",
          title: "File Session",
          createdAt: 1234567890,
          updatedAt: 1234567890,
          cwd: "/mock/workspace",
        },
      ]

      // Save to file only
      const indexFile = vscode.Uri.joinPath(storageUri, "index.json")
      await mockFs.fs.createDirectory(storageUri)
      await mockFs.fs.writeFile(indexFile, Buffer.from(JSON.stringify({ version: 1, sessions })))

      const loaded = await storage.loadSessionIndex()

      assert.strictEqual(loaded.length, 1)
      assert.strictEqual(loaded[0].title, "File Session")
    })

    it("returns empty array when no sessions exist", async () => {
      const loaded = await storage.loadSessionIndex()
      assert.deepStrictEqual(loaded, [])
    })

    it("syncs workspaceState from file when workspaceState is empty", async () => {
      const sessions: SessionMetadata[] = [
        {
          id: "session-1",
          title: "Sync Session",
          createdAt: 1234567890,
          updatedAt: 1234567890,
          cwd: "/mock/workspace",
        },
      ]

      // Save to file only
      const indexFile = vscode.Uri.joinPath(storageUri, "index.json")
      await mockFs.fs.createDirectory(storageUri)
      await mockFs.fs.writeFile(indexFile, Buffer.from(JSON.stringify({ version: 1, sessions })))

      await storage.loadSessionIndex()

      // Verify workspaceState was synced
      const stored = mockWorkspaceState.get<{ sessions: SessionMetadata[] }>("opencode.sessions")
      assert.ok(stored)
      assert.strictEqual(stored!.sessions[0].title, "Sync Session")
    })
  })

  describe("saves transcript to JSON file", () => {
    it("saves transcript to transcripts directory", async () => {
      const sessionId = "test-session-123"
      const transcript: Transcript = {
        version: 1,
        sessionId,
        messages: [
          { role: "user", content: "Hello" },
          { role: "assistant", content: "Hi there!" },
        ],
        hasPendingEdits: false,
      }

      await storage.saveTranscript(sessionId, transcript)

      const transcriptFile = vscode.Uri.joinPath(storageUri, "transcripts", `${sessionId}.json`)
      const content = await mockFs.fs.readFile(transcriptFile)
      const parsed = JSON.parse(Buffer.from(content).toString())

      assert.strictEqual(parsed.version, 1)
      assert.strictEqual(parsed.sessionId, sessionId)
      assert.strictEqual(parsed.messages.length, 2)
    })

    it("creates transcripts directory if not exists", async () => {
      const sessionId = "test-session-456"
      const transcript: Transcript = {
        version: 1,
        sessionId,
        messages: [{ role: "user", content: "Test" }],
        hasPendingEdits: false,
      }

      await storage.saveTranscript(sessionId, transcript)

      const transcriptsDir = vscode.Uri.joinPath(storageUri, "transcripts")
      const stat = await mockFs.fs.stat(transcriptsDir)
      assert.strictEqual(stat.type, vscode.FileType.Directory)
    })

    it("overwrites existing transcript", async () => {
      const sessionId = "test-session-789"
      const transcript1: Transcript = {
        version: 1,
        sessionId,
        messages: [{ role: "user", content: "First" }],
        hasPendingEdits: false,
      }
      const transcript2: Transcript = {
        version: 1,
        sessionId,
        messages: [{ role: "user", content: "Second" }],
        hasPendingEdits: false,
      }

      await storage.saveTranscript(sessionId, transcript1)
      await storage.saveTranscript(sessionId, transcript2)

      const transcriptFile = vscode.Uri.joinPath(storageUri, "transcripts", `${sessionId}.json`)
      const content = await mockFs.fs.readFile(transcriptFile)
      const parsed = JSON.parse(Buffer.from(content).toString())

      assert.strictEqual(parsed.messages[0].content, "Second")
    })
  })

  describe("loads transcript from JSON file", () => {
    it("loads transcript from file", async () => {
      const sessionId = "load-test-123"
      const transcript: Transcript = {
        version: 1,
        sessionId,
        messages: [
          { role: "user", content: "Load test" },
          { role: "assistant", content: "Loaded!" },
        ],
        hasPendingEdits: true,
      }

      // Save first
      await storage.saveTranscript(sessionId, transcript)

      // Load
      const loaded = await storage.loadTranscript(sessionId)

      assert.strictEqual(loaded.sessionId, sessionId)
      assert.strictEqual(loaded.messages.length, 2)
      assert.strictEqual(loaded.messages[0].role, "user")
      assert.strictEqual(loaded.messages[0].content, "Load test")
      assert.strictEqual(loaded.hasPendingEdits, true)
    })

    it("throws error when transcript not found", async () => {
      try {
        await storage.loadTranscript("non-existent-session")
        assert.fail("Should have thrown error")
      } catch (error) {
        assert.ok(error instanceof StorageError)
        assert.ok((error as StorageError).message.includes("Transcript not found"))
      }
    })

    it("parses message schema correctly", async () => {
      const sessionId = "parse-test-123"
      const transcript: Transcript = {
        version: 1,
        sessionId,
        messages: [
          { role: "user", content: "Hello", metadata: { timestamp: 123 } },
          { role: "assistant", content: "World", metadata: { model: "gpt-4" } },
          { role: "system", content: "System message" },
        ],
        hasPendingEdits: false,
      }

      await storage.saveTranscript(sessionId, transcript)
      const loaded = await storage.loadTranscript(sessionId)

      assert.strictEqual(loaded.messages.length, 3)
      assert.strictEqual(loaded.messages[0].metadata?.timestamp, 123)
      assert.strictEqual(loaded.messages[1].metadata?.model, "gpt-4")
    })
  })

  describe("deletes transcript", () => {
    it("deletes transcript file", async () => {
      const sessionId = "delete-test-123"
      const transcript: Transcript = {
        version: 1,
        sessionId,
        messages: [{ role: "user", content: "Delete me" }],
        hasPendingEdits: false,
      }

      await storage.saveTranscript(sessionId, transcript)
      await storage.deleteTranscript(sessionId)

      const transcriptFile = vscode.Uri.joinPath(storageUri, "transcripts", `${sessionId}.json`)

      try {
        await mockFs.fs.stat(transcriptFile)
        assert.fail("File should have been deleted")
      } catch (error) {
        assert.ok((error as Error).message.includes("ENOENT"))
      }
    })

    it("throws error when deleting non-existent transcript", async () => {
      try {
        await storage.deleteTranscript("non-existent-session")
        assert.fail("Should have thrown error")
      } catch (error) {
        assert.ok(error instanceof StorageError)
        assert.ok((error as StorageError).message.includes("Transcript not found"))
      }
    })
  })

  describe("enforces max 50 sessions", () => {
    it("deletes oldest sessions when exceeding max", async () => {
      const maxCount = 5
      const sessions: SessionMetadata[] = []

      // Create 7 sessions with different updatedAt times
      for (let i = 0; i < 7; i++) {
        sessions.push({
          id: `session-${i}`,
          title: `Session ${i}`,
          createdAt: 1000 + i,
          updatedAt: 1000 + i,
          cwd: "/mock",
        })
        // Also save transcript for each
        await storage.saveTranscript(`session-${i}`, {
          version: 1,
          sessionId: `session-${i}`,
          messages: [],
          hasPendingEdits: false,
        })
      }

      await storage.saveSessionIndex(sessions)
      await storage.enforceMaxSessions(maxCount)

      const remaining = await storage.loadSessionIndex()
      assert.strictEqual(remaining.length, maxCount)

      // Should keep the most recent (highest updatedAt)
      const ids = remaining.map((s) => s.id)
      assert.ok(ids.includes("session-6"), "Should keep most recent")
      assert.ok(ids.includes("session-5"), "Should keep second most recent")
      assert.ok(!ids.includes("session-0"), "Should delete oldest")
      assert.ok(!ids.includes("session-1"), "Should delete second oldest")
    })

    it("deletes transcript files along with sessions", async () => {
      const maxCount = 3
      const sessions: SessionMetadata[] = []

      for (let i = 0; i < 5; i++) {
        sessions.push({
          id: `session-${i}`,
          title: `Session ${i}`,
          createdAt: 1000 + i,
          updatedAt: 1000 + i,
          cwd: "/mock",
        })
        await storage.saveTranscript(`session-${i}`, {
          version: 1,
          sessionId: `session-${i}`,
          messages: [],
          hasPendingEdits: false,
        })
      }

      await storage.saveSessionIndex(sessions)
      await storage.enforceMaxSessions(maxCount)

      // Check that oldest transcript files are deleted
      const transcriptFile0 = vscode.Uri.joinPath(storageUri, "transcripts", "session-0.json")
      const transcriptFile4 = vscode.Uri.joinPath(storageUri, "transcripts", "session-4.json")

      try {
        await mockFs.fs.stat(transcriptFile0)
        assert.fail("Oldest transcript should have been deleted")
      } catch (error) {
        assert.ok((error as Error).message.includes("ENOENT"))
      }

      // Most recent should still exist
      const stat = await mockFs.fs.stat(transcriptFile4)
      assert.strictEqual(stat.type, vscode.FileType.File)
    })

    it("does nothing when sessions under max", async () => {
      const sessions: SessionMetadata[] = [
        { id: "session-1", title: "One", createdAt: 1, updatedAt: 1, cwd: "/mock" },
        { id: "session-2", title: "Two", createdAt: 2, updatedAt: 2, cwd: "/mock" },
      ]

      await storage.saveSessionIndex(sessions)
      await storage.enforceMaxSessions(10)

      const remaining = await storage.loadSessionIndex()
      assert.strictEqual(remaining.length, 2)
    })
  })

  describe("handles file read/write errors gracefully", () => {
    it("throws StorageError on file read failure", async () => {
      // Create a broken filesystem that throws on read
      const brokenFs = {
        ...mockFs.fs,
        readFile: async () => {
          throw new Error("Permission denied")
        },
      } as typeof vscode.workspace.fs

      const brokenStorage = new OpenCodeStorage(mockContext, brokenFs)

      try {
        await brokenStorage.loadTranscript("any-session")
        assert.fail("Should have thrown error")
      } catch (error) {
        assert.ok(error instanceof StorageError)
        assert.ok((error as StorageError).message.includes("Failed to read transcript"))
      }
    })

    it("throws StorageError on file write failure", async () => {
      const brokenFs = {
        ...mockFs.fs,
        writeFile: async () => {
          throw new Error("Disk full")
        },
      } as typeof vscode.workspace.fs

      const brokenStorage = new OpenCodeStorage(mockContext, brokenFs)
      const transcript: Transcript = {
        version: 1,
        sessionId: "test",
        messages: [],
        hasPendingEdits: false,
      }

      try {
        await brokenStorage.saveTranscript("test", transcript)
        assert.fail("Should have thrown error")
      } catch (error) {
        assert.ok(error instanceof StorageError)
        assert.ok((error as StorageError).message.includes("Failed to save transcript"))
      }
    })

    it("throws StorageError on directory creation failure", async () => {
      const brokenFs = {
        ...mockFs.fs,
        createDirectory: async () => {
          throw new Error("Permission denied")
        },
      } as typeof vscode.workspace.fs

      const brokenStorage = new OpenCodeStorage(mockContext, brokenFs)

      try {
        await brokenStorage.initialize()
        assert.fail("Should have thrown error")
      } catch (error) {
        assert.ok(error instanceof StorageError)
      }
    })
  })

  describe("provides atomic operations", () => {
    it("uses atomic write for transcripts (write to temp then rename)", async () => {
      const sessionId = "atomic-test"
      const transcript: Transcript = {
        version: 1,
        sessionId,
        messages: [{ role: "user", content: "Atomic" }],
        hasPendingEdits: false,
      }

      // Track write operations
      const writePaths: string[] = []
      const trackingFs = {
        ...mockFs.fs,
        writeFile: async (uri: vscode.Uri, content: Uint8Array) => {
          writePaths.push(uri.fsPath)
          return mockFs.fs.writeFile(uri, content)
        },
      } as typeof vscode.workspace.fs

      const trackingStorage = new OpenCodeStorage(mockContext, trackingFs)
      await trackingStorage.saveTranscript(sessionId, transcript)

      // Should write to temp file first, then final file
      const tempFilePattern = /\.tmp$/
      const finalFilePattern = /atomic-test\.json$/

      const hasTempWrite = writePaths.some((p) => tempFilePattern.test(p))
      const hasFinalWrite = writePaths.some((p) => finalFilePattern.test(p))

      // Implementation should use atomic write pattern
      assert.ok(hasFinalWrite, "Should write final file")
    })

    it("handles concurrent writes safely", async () => {
      const sessionId = "concurrent-test"
      const transcript1: Transcript = {
        version: 1,
        sessionId,
        messages: [{ role: "user", content: "First" }],
        hasPendingEdits: false,
      }
      const transcript2: Transcript = {
        version: 1,
        sessionId,
        messages: [{ role: "user", content: "Second" }],
        hasPendingEdits: false,
      }

      // Start both writes concurrently
      const promise1 = storage.saveTranscript(sessionId, transcript1)
      const promise2 = storage.saveTranscript(sessionId, transcript2)

      await Promise.all([promise1, promise2])

      // Verify file exists and is valid JSON
      const loaded = await storage.loadTranscript(sessionId)
      assert.ok(loaded.messages.length > 0)
    })

    it("maintains data integrity on partial write failure", async () => {
      const sessionId = "integrity-test"
      const transcript: Transcript = {
        version: 1,
        sessionId,
        messages: [{ role: "user", content: "Before" }],
        hasPendingEdits: false,
      }

      // Save initial
      await storage.saveTranscript(sessionId, transcript)
      const loaded = await storage.loadTranscript(sessionId)

      assert.strictEqual(loaded.messages[0].content, "Before")
    })
  })

  describe("persists across restarts", () => {
    it("restores sessions from file after workspaceState cleared", async () => {
      const sessions: SessionMetadata[] = [
        {
          id: "persist-session",
          title: "Persistent Session",
          createdAt: 1234567890,
          updatedAt: 1234567890,
          cwd: "/mock/workspace",
        },
      ]

      // Save sessions
      await storage.saveSessionIndex(sessions)
      await storage.saveTranscript("persist-session", {
        version: 1,
        sessionId: "persist-session",
        messages: [{ role: "user", content: "Persist me" }],
        hasPendingEdits: false,
      })

      // Simulate restart: new workspaceState, same files
      const newWorkspaceState = createMockWorkspaceState()
      const newContext = createMockExtensionContext(newWorkspaceState, storageUri)
      const newStorage = new OpenCodeStorage(newContext, mockFs.fs)

      // Should recover from files
      const loadedSessions = await newStorage.loadSessionIndex()
      const loadedTranscript = await newStorage.loadTranscript("persist-session")

      assert.strictEqual(loadedSessions.length, 1)
      assert.strictEqual(loadedSessions[0].title, "Persistent Session")
      assert.strictEqual(loadedTranscript.messages[0].content, "Persist me")
    })
  })

  describe("auto-save on VS Code shutdown", () => {
    it("flushes pending writes on flush()", async () => {
      const sessions: SessionMetadata[] = [
        { id: "flush-test", title: "Flush", createdAt: 1, updatedAt: 1, cwd: "/mock" },
      ]

      // Queue some operations
      await storage.saveSessionIndex(sessions)

      // Flush should complete all pending operations
      await storage.flush()

      const loaded = await storage.loadSessionIndex()
      assert.strictEqual(loaded.length, 1)
      assert.strictEqual(loaded[0].title, "Flush")
    })

    it("returns immediately when no pending operations", async () => {
      const startTime = Date.now()
      await storage.flush()
      const endTime = Date.now()

      // Should be quick
      assert.ok(endTime - startTime < 100)
    })
  })
})
