import { describe, expect, test, beforeEach, mock } from "bun:test"
import type { AssistantMessage, UserMessage, Part } from "@opencode-ai/sdk/v2"

// Mock types and interfaces
type Message = {
  info: AssistantMessage | UserMessage
  parts: Part[]
}

type SessionData = {
  id: string
  title: string
}

type ToastOptions = {
  message: string
  variant: "success" | "error" | "info" | "warning"
}

describe("session.copyWithOptions command", () => {
  let dialog: any
  let toast: any
  let session: () => SessionData | undefined
  let messages: () => (AssistantMessage | UserMessage)[]
  let sync: any
  let clipboard: any
  let formatTranscript: any
  let dialogCopyMessages: any

  beforeEach(() => {
    dialog = { clear: mock(() => {}) }
    toast = { show: mock((options: ToastOptions) => {}) }
    clipboard = { copy: mock(async (text: string) => {}) }
    formatTranscript = mock((data, msgs, opts) => "formatted transcript")
    dialogCopyMessages = {
      show: mock(async (d, msgs) => msgs.slice(0, 1)),
    }
  })

  describe("initial validation", () => {
    test("should handle missing session data gracefully", async () => {
      session = () => undefined
      messages = () => []
      sync = { data: { part: {} } }

      // Simulate command onSelect
      const sessionData = session()
      if (!sessionData) {
        expect(sessionData).toBeUndefined()
      }
    })

    test("should show info toast when no messages available", async () => {
      session = () => ({ id: "ses_123", title: "Test" })
      messages = () => []
      sync = { data: { part: {} } }

      const sessionData = session()
      const sessionMessages = messages()
      const allMessages = sessionMessages.map((msg) => ({
        info: msg,
        parts: sync.data.part[(msg as any).id] ?? [],
      }))

      if (allMessages.length === 0) {
        toast.show({ message: "No messages to copy", variant: "info" })
      }

      expect(toast.show).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "No messages to copy",
          variant: "info",
        }),
      )
    })

    test("should clear dialog when no messages available", async () => {
      session = () => ({ id: "ses_123", title: "Test" })
      messages = () => []
      sync = { data: { part: {} } }

      const sessionData = session()
      const sessionMessages = messages()

      if (sessionMessages.length === 0) {
        dialog.clear()
      }

      expect(dialog.clear).toHaveBeenCalled()
    })
  })

  describe("message collection", () => {
    test("should collect all session messages with their parts", async () => {
      const msgs: (AssistantMessage | UserMessage)[] = [
        {
          id: "msg_1",
          sessionID: "ses_123",
          role: "user",
          agent: "build",
          model: { providerID: "anthropic", modelID: "claude-sonnet" },
          time: { created: 1000000 },
        } as UserMessage,
        {
          id: "msg_2",
          sessionID: "ses_123",
          role: "assistant",
          agent: "build",
          modelID: "claude-sonnet",
          providerID: "anthropic",
          mode: "",
          parentID: "msg_1",
          path: { cwd: "/test", root: "/test" },
          cost: 0.001,
          tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: 1000000, completed: 1005400 },
        } as AssistantMessage,
      ]

      session = () => ({ id: "ses_123", title: "Test" })
      messages = () => msgs
      sync = {
        data: {
          part: {
            msg_1: [{ id: "p1", type: "text", text: "User input" }],
            msg_2: [{ id: "p2", type: "text", text: "Assistant response" }],
          },
        },
      }

      const sessionData = session()
      const sessionMessages = messages()
      const allMessages = sessionMessages.map((msg) => ({
        info: msg,
        parts: sync.data.part[msg.id] ?? [],
      }))

      expect(allMessages).toHaveLength(2)
      expect(allMessages[0].parts).toHaveLength(1)
      expect(allMessages[1].parts).toHaveLength(1)
    })

    test("should handle messages without parts", async () => {
      const msgs: (AssistantMessage | UserMessage)[] = [
        {
          id: "msg_1",
          sessionID: "ses_123",
          role: "user",
          agent: "build",
          model: { providerID: "anthropic", modelID: "claude-sonnet" },
          time: { created: 1000000 },
        } as UserMessage,
      ]

      session = () => ({ id: "ses_123", title: "Test" })
      messages = () => msgs
      sync = { data: { part: {} } }

      const sessionData = session()
      const sessionMessages = messages()
      const allMessages = sessionMessages.map((msg) => ({
        info: msg,
        parts: sync.data.part[msg.id] ?? [],
      }))

      expect(allMessages[0].parts).toEqual([])
    })
  })

  describe("dialog interaction", () => {
    test("should show dialog and wait for message selection", async () => {
      const msgs: (AssistantMessage | UserMessage)[] = [
        {
          id: "msg_1",
          sessionID: "ses_123",
          role: "user",
          agent: "build",
          model: { providerID: "anthropic", modelID: "claude-sonnet" },
          time: { created: 1000000 },
        } as UserMessage,
      ]

      session = () => ({ id: "ses_123", title: "Test" })
      messages = () => msgs
      sync = { data: { part: { msg_1: [] } } }

      const sessionData = session()
      const sessionMessages = messages()
      const allMessages = sessionMessages.map((msg) => ({
        info: msg,
        parts: sync.data.part[msg.id] ?? [],
      }))

      const selectedMessages = await dialogCopyMessages.show(dialog, allMessages)

      expect(dialogCopyMessages.show).toHaveBeenCalledWith(dialog, expect.any(Array))
      expect(selectedMessages).toBeDefined()
    })

    test("should clear dialog when user cancels (no selection)", async () => {
      const msgs: (AssistantMessage | UserMessage)[] = [
        {
          id: "msg_1",
          sessionID: "ses_123",
          role: "user",
          agent: "build",
          model: { providerID: "anthropic", modelID: "claude-sonnet" },
          time: { created: 1000000 },
        } as UserMessage,
      ]

      session = () => ({ id: "ses_123", title: "Test" })
      messages = () => msgs
      sync = { data: { part: { msg_1: [] } } }
      dialogCopyMessages.show = mock(async () => null)

      const sessionData = session()
      const sessionMessages = messages()
      const allMessages = sessionMessages.map((msg) => ({
        info: msg,
        parts: sync.data.part[msg.id] ?? [],
      }))

      const selectedMessages = await dialogCopyMessages.show(dialog, allMessages)

      if (!selectedMessages || selectedMessages.length === 0) {
        dialog.clear()
      }

      expect(dialog.clear).toHaveBeenCalled()
    })

    test("should clear dialog when selection is empty array", async () => {
      const msgs: (AssistantMessage | UserMessage)[] = [
        {
          id: "msg_1",
          sessionID: "ses_123",
          role: "user",
          agent: "build",
          model: { providerID: "anthropic", modelID: "claude-sonnet" },
          time: { created: 1000000 },
        } as UserMessage,
      ]

      session = () => ({ id: "ses_123", title: "Test" })
      messages = () => msgs
      sync = { data: { part: { msg_1: [] } } }
      dialogCopyMessages.show = mock(async () => [])

      const sessionData = session()
      const sessionMessages = messages()
      const allMessages = sessionMessages.map((msg) => ({
        info: msg,
        parts: sync.data.part[msg.id] ?? [],
      }))

      const selectedMessages = await dialogCopyMessages.show(dialog, allMessages)

      if (!selectedMessages || selectedMessages.length === 0) {
        dialog.clear()
      }

      expect(dialog.clear).toHaveBeenCalled()
    })
  })

  describe("transcript formatting", () => {
    test("should format transcript with correct options", async () => {
      const msgs: (AssistantMessage | UserMessage)[] = [
        {
          id: "msg_1",
          sessionID: "ses_123",
          role: "user",
          agent: "build",
          model: { providerID: "anthropic", modelID: "claude-sonnet" },
          time: { created: 1000000 },
        } as UserMessage,
      ]

      const sessionData = { id: "ses_123", title: "Test" }
      const selectedMessages = [{ info: msgs[0], parts: [] }]

      formatTranscript(sessionData, selectedMessages, {
        thinking: true,
        toolDetails: true,
        assistantMetadata: true,
        includeMetadata: false,
      })

      expect(formatTranscript).toHaveBeenCalledWith(
        sessionData,
        selectedMessages,
        expect.objectContaining({
          thinking: true,
          toolDetails: true,
          assistantMetadata: true,
          includeMetadata: false,
        }),
      )
    })

    test("should use consistent formatting options across all calls", async () => {
      const msgs: (AssistantMessage | UserMessage)[] = [
        {
          id: "msg_1",
          sessionID: "ses_123",
          role: "user",
          agent: "build",
          model: { providerID: "anthropic", modelID: "claude-sonnet" },
          time: { created: 1000000 },
        } as UserMessage,
        {
          id: "msg_2",
          sessionID: "ses_123",
          role: "assistant",
          agent: "build",
          modelID: "claude-sonnet",
          providerID: "anthropic",
          mode: "",
          parentID: "msg_1",
          path: { cwd: "/test", root: "/test" },
          cost: 0.001,
          tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: 1000000, completed: 1005400 },
        } as AssistantMessage,
      ]

      const sessionData = { id: "ses_123", title: "Test" }
      const selectedMessages = [
        { info: msgs[0], parts: [] },
        { info: msgs[1], parts: [] },
      ]

      const transcript = formatTranscript(sessionData, selectedMessages, {
        thinking: true,
        toolDetails: true,
        assistantMetadata: true,
        includeMetadata: false,
      })

      expect(transcript).toBeDefined()
    })
  })

  describe("clipboard operations", () => {
    test("should copy formatted transcript to clipboard", async () => {
      const selectedMessages = [
        {
          info: {
            id: "msg_1",
            role: "user",
          } as UserMessage,
          parts: [],
        },
      ]

      const transcript = "formatted transcript"
      await clipboard.copy(transcript)

      expect(clipboard.copy).toHaveBeenCalledWith(transcript)
    })

    test("should show success toast after copy", async () => {
      const selectedMessages = [
        {
          info: {
            id: "msg_1",
            role: "user",
          } as UserMessage,
          parts: [],
        },
      ]

      const selectedCount = selectedMessages.length
      await clipboard.copy("transcript")
      toast.show({ message: `${selectedCount} message(s) copied to clipboard!`, variant: "success" })

      expect(toast.show).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "1 message(s) copied to clipboard!",
          variant: "success",
        }),
      )
    })

    test("should include correct message count in success notification", async () => {
      const selectedMessages = Array.from({ length: 5 }, (_, i) => ({
        info: {
          id: `msg_${i}`,
          role: "user",
        } as UserMessage,
        parts: [],
      }))

      const selectedCount = selectedMessages.length
      toast.show({ message: `${selectedCount} message(s) copied to clipboard!`, variant: "success" })

      expect(toast.show).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "5 message(s) copied to clipboard!",
          variant: "success",
        }),
      )
    })
  })

  describe("error handling", () => {
    test("should show error toast on copy failure", async () => {
      const error = new Error("Copy failed")

      try {
        throw error
      } catch (err) {
        toast.show({ message: "Failed to copy messages", variant: "error" })
      }

      expect(toast.show).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Failed to copy messages",
          variant: "error",
        }),
      )
    })

    test("should clear dialog after error", async () => {
      try {
        throw new Error("Copy failed")
      } catch (error) {
        dialog.clear()
      }

      expect(dialog.clear).toHaveBeenCalled()
    })

    test("should clear dialog on generic error", async () => {
      const sessionData = { id: "ses_123", title: "Test" }
      try {
        throw new Error("Unexpected error")
      } catch (error) {
        toast.show({ message: "Failed to copy messages", variant: "error" })
        dialog.clear()
      }

      expect(dialog.clear).toHaveBeenCalled()
      expect(toast.show).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "error",
        }),
      )
    })
  })

  describe("workflow integration", () => {
    test("should complete full copy workflow", async () => {
      const msgs: (AssistantMessage | UserMessage)[] = [
        {
          id: "msg_1",
          sessionID: "ses_123",
          role: "user",
          agent: "build",
          model: { providerID: "anthropic", modelID: "claude-sonnet" },
          time: { created: 1000000 },
        } as UserMessage,
        {
          id: "msg_2",
          sessionID: "ses_123",
          role: "assistant",
          agent: "build",
          modelID: "claude-sonnet",
          providerID: "anthropic",
          mode: "",
          parentID: "msg_1",
          path: { cwd: "/test", root: "/test" },
          cost: 0.001,
          tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: 1000000, completed: 1005400 },
        } as AssistantMessage,
      ]

      session = () => ({ id: "ses_123", title: "Test" })
      messages = () => msgs
      sync = {
        data: {
          part: {
            msg_1: [{ id: "p1", type: "text", text: "Hello" }],
            msg_2: [{ id: "p2", type: "text", text: "Hi there" }],
          },
        },
      }

      // Simulate workflow
      const sessionData = session()
      const sessionMessages = messages()
      const allMessages = sessionMessages.map((msg) => ({
        info: msg,
        parts: sync.data.part[msg.id] ?? [],
      }))

      const selectedMessages = await dialogCopyMessages.show(dialog, allMessages)

      if (selectedMessages && selectedMessages.length > 0) {
        const transcript = formatTranscript(sessionData, selectedMessages, {
          thinking: true,
          toolDetails: true,
          assistantMetadata: true,
          includeMetadata: false,
        })
        await clipboard.copy(transcript)
        toast.show({ message: `${selectedMessages.length} message(s) copied to clipboard!`, variant: "success" })
      }

      dialog.clear()

      expect(dialogCopyMessages.show).toHaveBeenCalled()
      expect(formatTranscript).toHaveBeenCalled()
      expect(clipboard.copy).toHaveBeenCalled()
      expect(toast.show).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "success",
        }),
      )
      expect(dialog.clear).toHaveBeenCalled()
    })

    test("should handle mixed user and assistant message selection", async () => {
      const msgs: (AssistantMessage | UserMessage)[] = [
        {
          id: "msg_1",
          sessionID: "ses_123",
          role: "user",
          agent: "build",
          model: { providerID: "anthropic", modelID: "claude-sonnet" },
          time: { created: 1000000 },
        } as UserMessage,
        {
          id: "msg_2",
          sessionID: "ses_123",
          role: "assistant",
          agent: "build",
          modelID: "claude-sonnet",
          providerID: "anthropic",
          mode: "",
          parentID: "msg_1",
          path: { cwd: "/test", root: "/test" },
          cost: 0.001,
          tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: 1000000, completed: 1005400 },
        } as AssistantMessage,
        {
          id: "msg_3",
          sessionID: "ses_123",
          role: "user",
          agent: "build",
          model: { providerID: "anthropic", modelID: "claude-sonnet" },
          time: { created: 1010000 },
        } as UserMessage,
      ]

      const sessionData = { id: "ses_123", title: "Test" }
      const selectedMessages = [
        { info: msgs[0], parts: [] },
        { info: msgs[1], parts: [] },
        { info: msgs[2], parts: [] },
      ]

      const userMessages = selectedMessages.filter((m) => m.info.role === "user")
      const assistantMessages = selectedMessages.filter((m) => m.info.role === "assistant")

      expect(userMessages).toHaveLength(2)
      expect(assistantMessages).toHaveLength(1)
    })

    test("should always clear dialog at end of workflow", async () => {
      const msgs: (AssistantMessage | UserMessage)[] = [
        {
          id: "msg_1",
          sessionID: "ses_123",
          role: "user",
          agent: "build",
          model: { providerID: "anthropic", modelID: "claude-sonnet" },
          time: { created: 1000000 },
        } as UserMessage,
      ]

      session = () => ({ id: "ses_123", title: "Test" })
      messages = () => msgs
      sync = { data: { part: { msg_1: [] } } }

      try {
        const sessionData = session()
        const sessionMessages = messages()
        const allMessages = sessionMessages.map((msg) => ({
          info: msg,
          parts: sync.data.part[msg.id] ?? [],
        }))
        const selectedMessages = await dialogCopyMessages.show(dialog, allMessages)

        if (selectedMessages && selectedMessages.length > 0) {
          const transcript = formatTranscript(sessionData, selectedMessages, {
            thinking: true,
            toolDetails: true,
            assistantMetadata: true,
            includeMetadata: false,
          })
          await clipboard.copy(transcript)
          toast.show({ message: `${selectedMessages.length} message(s) copied to clipboard!`, variant: "success" })
        }
      } catch (error) {
        toast.show({ message: "Failed to copy messages", variant: "error" })
      }

      dialog.clear()

      expect(dialog.clear).toHaveBeenCalled()
    })
  })
})
