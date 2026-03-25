/**
 * Tests for the IDE editor context pipeline: subscribing to context updates,
 * handling error conditions, schema validation, and system prompt formatting.
 *
 * Uses a fake MCP client — the real server is tested separately in
 * sdks/vscode/test/mcp-server.test.ts.
 */

import { describe, test, expect, afterEach, beforeEach } from "bun:test"
import { Ide } from "../../src/ide/index.js"
import { Instance } from "../../src/project/instance"
import { SystemPrompt } from "../../src/session/system"
import { tmpdir } from "../fixture/fixture"

// ---------------------------------------------------------------------------
// Fake MCP Client
// ---------------------------------------------------------------------------

/**
 * Minimal fake of the MCP SDK Client, implementing only the methods that
 * subscribeToContext uses. Returns canned responses rather than making real
 * network calls. Avoids importing the real Client class, which can be
 * replaced by mock.module() in other test files (Bun shares the module
 * cache across test files with no isolation).
 */
function createFakeClient(opts: {
  /** JSON object or raw string to return from readResource for editor://context. */
  context: Record<string, unknown> | string
  /** If true, readResource throws instead of returning data. */
  failRead?: boolean
}) {
  let notificationHandler: ((notification: { params: { uri: string } }) => Promise<void>) | undefined
  let onclose: (() => void) | undefined

  return {
    /** Returns canned resource contents, or throws if failRead is set. */
    async readResource(_params: { uri: string }) {
      if (opts.failRead) throw new Error("simulated read failure")
      const text = typeof opts.context === "string" ? opts.context : JSON.stringify(opts.context)
      return {
        contents: [
          {
            uri: "editor://context",
            mimeType: "application/json",
            text,
          },
        ],
      }
    },

    /** No-op — accepts the subscription without tracking it. */
    async subscribeResource(_params: { uri: string }) {},

    /** Captures the notification handler so tests can trigger it. */
    setNotificationHandler(_schema: unknown, handler: (notification: { params: { uri: string } }) => Promise<void>) {
      notificationHandler = handler
    },

    /** Setter for the disconnect callback. */
    set onclose(handler: (() => void) | undefined) {
      onclose = handler
    },

    // -- Test helpers (not part of the real Client interface) --

    /** Simulate a resource-updated notification from the server. */
    async sendNotification(uri: string) {
      if (notificationHandler) {
        await notificationHandler({ params: { uri } })
      }
    },

    /** Simulate a disconnect. */
    triggerClose() {
      if (onclose) onclose()
    },

    /** Update the context that readResource returns (for mid-test changes). */
    setContext(context: Record<string, unknown> | string) {
      opts.context = context
    },

    /** Toggle whether readResource throws. */
    setFailRead(fail: boolean) {
      opts.failRead = fail
    },
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("subscribeToContext", () => {
  // subscribeToContext uses Instance.state() internally, which requires an
  // active Instance context (AsyncLocalStorage). We create a temp directory
  // per test and hold onto the cleanup handle.
  let tmp: Awaited<ReturnType<typeof tmpdir>>

  beforeEach(async () => {
    tmp = await tmpdir({ git: true })
  })

  afterEach(async () => {
    await tmp[Symbol.asyncDispose]()
  })

  test("reads initial context and updates on notification", async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        expect(Ide.editorContext()).toEqual({})

        const client = createFakeClient({
          context: { uri: "/initial/file.ts" },
        })

        await Ide.subscribeToContext(client as any)

        // Initial state was read.
        expect(Ide.editorContext().uri).toBe("/initial/file.ts")

        // Simulate the server-side file change + notification.
        client.setContext({ uri: "/updated/file.ts" })
        await client.sendNotification("editor://context")

        expect(Ide.editorContext().uri).toBe("/updated/file.ts")
      },
    })
  })

  test("clears context when client disconnects", async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const client = createFakeClient({
          context: { uri: "/some/file.ts" },
        })

        await Ide.subscribeToContext(client as any)
        expect(Ide.editorContext().uri).toBe("/some/file.ts")

        client.triggerClose()

        expect(Ide.editorContext()).toEqual({})
      },
    })
  })

  test("ignores notifications for unrelated URIs", async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const client = createFakeClient({
          context: { uri: "/initial/file.ts" },
        })

        await Ide.subscribeToContext(client as any)
        expect(Ide.editorContext().uri).toBe("/initial/file.ts")

        // Change the context the mock would return, but send a notification
        // for a different URI — subscribeToContext should ignore it.
        client.setContext({ uri: "/should-not-update.ts" })
        await client.sendNotification("editor://other")

        expect(Ide.editorContext().uri).toBe("/initial/file.ts")
      },
    })
  })

  // -------------------------------------------------------------------------
  // Context shapes — verify all valid EditorContext variants round-trip
  // -------------------------------------------------------------------------

  test("handles empty context (no active editor)", async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const client = createFakeClient({ context: {} })
        await Ide.subscribeToContext(client as any)

        const ctx = Ide.editorContext()
        expect(ctx).toEqual({})
        expect(ctx.uri).toBeUndefined()
        expect(ctx.selection).toBeUndefined()
      },
    })
  })

  test("handles context with uri and selection", async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const client = createFakeClient({
          context: {
            uri: "file:///workspace/src/app.tsx",
            selection: {
              start: { line: 10, column: 0 },
              end: { line: 15, column: 42 },
              text: "const x = 1",
            },
          },
        })
        await Ide.subscribeToContext(client as any)

        const ctx = Ide.editorContext()
        expect(ctx.uri).toBe("file:///workspace/src/app.tsx")
        expect(ctx.selection).toBeDefined()
        expect(ctx.selection!.text).toBe("const x = 1")
        expect(ctx.selection!.start.line).toBe(10)
        expect(ctx.selection!.end.column).toBe(42)
      },
    })
  })

  // -------------------------------------------------------------------------
  // refreshContext error handling — malformed data must not crash or corrupt
  // -------------------------------------------------------------------------

  test("survives readResource failure without corrupting state", async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // First, establish valid state.
        const client = createFakeClient({ context: { uri: "/good/file.ts" } })
        await Ide.subscribeToContext(client as any)
        expect(Ide.editorContext().uri).toBe("/good/file.ts")

        // Now make readResource fail and trigger a notification.
        client.setFailRead(true)
        await client.sendNotification("editor://context")

        // State should be unchanged — the failed read is swallowed.
        expect(Ide.editorContext().uri).toBe("/good/file.ts")
      },
    })
  })

  test("survives malformed JSON without corrupting state", async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const client = createFakeClient({ context: { uri: "/good/file.ts" } })
        await Ide.subscribeToContext(client as any)
        expect(Ide.editorContext().uri).toBe("/good/file.ts")

        // Return invalid JSON from the resource.
        client.setContext("{not-valid-json" as any)
        await client.sendNotification("editor://context")

        // State should be unchanged.
        expect(Ide.editorContext().uri).toBe("/good/file.ts")
      },
    })
  })

  test("survives schema validation failure without corrupting state", async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const client = createFakeClient({ context: { uri: "/good/file.ts" } })
        await Ide.subscribeToContext(client as any)
        expect(Ide.editorContext().uri).toBe("/good/file.ts")

        // Return valid JSON that doesn't match the EditorContext schema
        // (selection missing required fields).
        client.setContext({ uri: 123, selection: "not-an-object" } as any)
        await client.sendNotification("editor://context")

        // State should be unchanged.
        expect(Ide.editorContext().uri).toBe("/good/file.ts")
      },
    })
  })
})

// ---------------------------------------------------------------------------
// EditorContext schema — contract between VS Code extension and CLI
// ---------------------------------------------------------------------------

describe("EditorContext schema", () => {
  const schema = Ide.Event.ContextUpdated.properties

  test("accepts empty object (no active editor)", () => {
    const result = schema.safeParse({})
    expect(result.success).toBe(true)
  })

  test("accepts uri only", () => {
    const result = schema.safeParse({ uri: "file:///workspace/index.ts" })
    expect(result.success).toBe(true)
    expect(result.data!.uri).toBe("file:///workspace/index.ts")
  })

  test("accepts uri with selection", () => {
    const result = schema.safeParse({
      uri: "git:///workspace/index.ts?ref=HEAD",
      selection: {
        start: { line: 0, column: 0 },
        end: { line: 5, column: 10 },
        text: "hello",
      },
    })
    expect(result.success).toBe(true)
    expect(result.data!.selection!.text).toBe("hello")
  })

  test("rejects uri with wrong type", () => {
    const result = schema.safeParse({ uri: 42 })
    expect(result.success).toBe(false)
  })

  test("rejects selection missing required fields", () => {
    const result = schema.safeParse({
      uri: "file:///foo",
      selection: { start: { line: 0, column: 0 } },
    })
    expect(result.success).toBe(false)
  })

  test("strips unknown fields", () => {
    const result = schema.safeParse({ uri: "file:///foo", extra: "field" })
    expect(result.success).toBe(true)
    expect((result.data as any).extra).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// getIdeContext — system prompt formatting
// ---------------------------------------------------------------------------

describe("getIdeContext", () => {
  let tmp: Awaited<ReturnType<typeof tmpdir>>

  beforeEach(async () => {
    tmp = await tmpdir({ git: true })
  })

  afterEach(async () => {
    await tmp[Symbol.asyncDispose]()
  })

  test("returns empty array when no editor is active", async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // Default state — no IDE connected.
        expect(SystemPrompt.getIdeContext()).toEqual([])
      },
    })
  })

  test("returns empty array for empty context (connected but no open file)", async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const client = createFakeClient({ context: {} })
        await Ide.subscribeToContext(client as any)

        expect(SystemPrompt.getIdeContext()).toEqual([])
      },
    })
  })

  test("formats uri-only context", async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const client = createFakeClient({ context: { uri: "file:///workspace/app.ts" } })
        await Ide.subscribeToContext(client as any)

        const result = SystemPrompt.getIdeContext().join("\n")
        expect(result).toContain("<ide-context>")
        expect(result).toContain("file:///workspace/app.ts")
        expect(result).toContain("</ide-context>")
      },
    })
  })

  test("formats context with selection and 1-indexed lines", async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const client = createFakeClient({
          context: {
            uri: "file:///workspace/app.ts",
            selection: {
              start: { line: 0, column: 0 },
              end: { line: 1, column: 11 },
              text: "const x = 1\nconst y = 2",
            },
          },
        })
        await Ide.subscribeToContext(client as any)

        const result = SystemPrompt.getIdeContext().join("\n")
        // Lines are 0-indexed from VS Code, displayed as 1-indexed.
        expect(result).toContain("<ide-context>")
        expect(result).toContain("lines 1-2 selected:")
        expect(result).toContain("const x = 1\nconst y = 2")
        expect(result).toContain("file:///workspace/app.ts")
        expect(result).toContain("</ide-context>")
      },
    })
  })

  test("uses singular 'line' for single-line selection", async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const client = createFakeClient({
          context: {
            uri: "file:///workspace/app.ts",
            selection: {
              start: { line: 4, column: 0 },
              end: { line: 4, column: 15 },
              text: "const x = 'hi'",
            },
          },
        })
        await Ide.subscribeToContext(client as any)

        const result = SystemPrompt.getIdeContext().join("\n")
        expect(result).toContain("line 5 selected:")
        expect(result).not.toContain("lines")
      },
    })
  })
})
