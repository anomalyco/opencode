import { strict as assert } from "assert"
import { describe, it, beforeEach, afterEach } from "mocha"
import * as vscode from "vscode"
import { OpenCodeChatParticipant } from "./participant"
import { ActivationController, ActivationState } from "./activation"

// Mock vscode.chat API
const mockCreateChatParticipant = (id: string, handler: vscode.ChatRequestHandler): vscode.ChatParticipant => ({
  id,
  requestHandler: handler,
  iconPath: undefined,
  followupProvider: undefined,
  onDidReceiveFeedback: () => ({ dispose: () => {} }),
  dispose: () => {},
})

// Mock ActivationController
class MockActivationController {
  state = ActivationState.INACTIVE
  activeSessions = 0

  async ensureActivated(): Promise<any> {
    this.state = ActivationState.ACTIVE
    return {
      getState: () => "initialized",
      dispose: async () => {},
    }
  }

  onSessionStarted(): void {
    this.activeSessions++
  }

  onSessionEnded(): void {
    this.activeSessions--
    if (this.activeSessions < 0) this.activeSessions = 0
  }

  getState(): ActivationState {
    return this.state
  }

  getActiveSessions(): number {
    return this.activeSessions
  }

  async dispose(): Promise<void> {
    this.state = ActivationState.DISPOSED
  }
}

describe("OpenCodeChatParticipant", () => {
  let participant: OpenCodeChatParticipant
  let mockContext: vscode.ExtensionContext
  let mockActivationController: MockActivationController

  beforeEach(() => {
    // Create mock extension context
    mockContext = {
      subscriptions: [],
      asAbsolutePath: (relativePath: string) => `/mock/path/${relativePath}`,
    } as unknown as vscode.ExtensionContext

    // Create mock activation controller
    mockActivationController = new MockActivationController()

    // Mock vscode.chat.createChatParticipant
    ;(global as any).vscode = {
      chat: {
        createChatParticipant: mockCreateChatParticipant,
      },
      Uri: {
        file: (path: string) => ({ path }),
      },
    }
  })

  afterEach(() => {
    if (participant) {
      participant.dispose()
    }
  })

  describe("registration", () => {
    it("registers chat participant with correct ID", () => {
      participant = new OpenCodeChatParticipant(mockContext, mockActivationController as any)
      participant.register()

      assert.strictEqual(participant.id, "sst-dev.opencode")
    })

    it("has correct metadata", () => {
      participant = new OpenCodeChatParticipant(mockContext, mockActivationController as any)
      participant.register()

      assert.strictEqual(participant.metadata.name, "opencode")
      assert.strictEqual(participant.metadata.fullName, "OpenCode")
      assert.strictEqual(participant.metadata.description, "AI coding assistant powered by OpenCode")
      assert.strictEqual(participant.metadata.isSticky, true)
    })

    it("follows Microsoft naming conventions", () => {
      participant = new OpenCodeChatParticipant(mockContext, mockActivationController as any)
      participant.register()

      // name should be lowercase
      assert.strictEqual(participant.metadata.name, participant.metadata.name.toLowerCase())

      // fullName should be Title Case
      const words = participant.metadata.fullName.split(" ")
      words.forEach((word) => {
        assert.strictEqual(word[0], word[0].toUpperCase())
      })
    })
  })

  describe("slash commands", () => {
    it("has /new command for starting new session", () => {
      participant = new OpenCodeChatParticipant(mockContext, mockActivationController as any)
      participant.register()

      const commands = participant.metadata.commands
      const newCommand = commands.find((c) => c.name === "new")

      assert.ok(newCommand, "Should have /new command")
      assert.ok(newCommand.description.toLowerCase().includes("new"), "Description should mention 'new'")
    })

    it("has /clear command for clearing conversation", () => {
      participant = new OpenCodeChatParticipant(mockContext, mockActivationController as any)
      participant.register()

      const commands = participant.metadata.commands
      const clearCommand = commands.find((c) => c.name === "clear")

      assert.ok(clearCommand, "Should have /clear command")
      assert.ok(clearCommand.description.toLowerCase().includes("clear"), "Description should mention 'clear'")
    })

    it("has exactly 2 slash commands", () => {
      participant = new OpenCodeChatParticipant(mockContext, mockActivationController as any)
      participant.register()

      assert.strictEqual(participant.metadata.commands.length, 2)
    })
  })

  describe("@opencode mentions", () => {
    it("handles @opencode mentions", () => {
      participant = new OpenCodeChatParticipant(mockContext, mockActivationController as any)
      participant.register()

      assert.ok(participant.canHandleMention("@opencode"), "Should handle @opencode mention")
      assert.ok(participant.canHandleMention("opencode"), "Should handle bare opencode mention")
      assert.ok(participant.canHandleMention("@sst-dev.opencode"), "Should handle extension ID mention")
    })

    it("does not handle other mentions", () => {
      participant = new OpenCodeChatParticipant(mockContext, mockActivationController as any)
      participant.register()

      assert.strictEqual(participant.canHandleMention("@other"), false)
      assert.strictEqual(participant.canHandleMention("@github"), false)
    })
  })

  describe("icon configuration", () => {
    it("sets icon path when registering", () => {
      participant = new OpenCodeChatParticipant(mockContext, mockActivationController as any)
      participant.register()

      assert.ok(participant.iconPath, "Should have icon path set")
    })
  })

  describe("followup provider", () => {
    it("has followup provider set", () => {
      participant = new OpenCodeChatParticipant(mockContext, mockActivationController as any)
      participant.register()

      assert.ok(participant.followupProvider, "Should have followup provider")
    })
  })

  describe("chat request handler", () => {
    it("registers a handler function", () => {
      participant = new OpenCodeChatParticipant(mockContext, mockActivationController as any)
      participant.register()

      assert.ok(typeof participant.handler === "function", "Should have a handler function")
    })
  })

  describe("activation controller integration", () => {
    it("tracks session lifecycle during chat requests", async () => {
      participant = new OpenCodeChatParticipant(mockContext, mockActivationController as any)
      participant.register()

      // Create mock request and response
      const mockRequest = { command: undefined } as any
      const mockResponse = { markdown: () => {} } as any
      const mockToken = { isCancellationRequested: false } as any

      // Call the handler
      await participant.handler(mockRequest, {} as any, mockResponse, mockToken)

      // Session should be started then ended
      assert.strictEqual(mockActivationController.activeSessions, 0, "Sessions should be cleaned up")
    })

    it("activates ACP on first message", async () => {
      participant = new OpenCodeChatParticipant(mockContext, mockActivationController as any)
      participant.register()

      const mockRequest = { command: undefined } as any
      const mockResponse = { markdown: () => {} } as any
      const mockToken = { isCancellationRequested: false } as any

      assert.strictEqual(mockActivationController.state, ActivationState.INACTIVE)

      await participant.handler(mockRequest, {} as any, mockResponse, mockToken)

      assert.strictEqual(mockActivationController.state, ActivationState.ACTIVE)
    })
  })
})
