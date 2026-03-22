import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import z from "zod"
import { NamedError } from "@opencode-ai/util/error"
import { Log } from "../util/log"
import { Process } from "@/util/process"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { ResourceUpdatedNotificationSchema } from "@modelcontextprotocol/sdk/types.js"
import { Installation } from "../installation"
import fs from "fs/promises"
import path from "path"
import { Instance } from "../project/instance"

const SUPPORTED_IDES = [
  { name: "Windsurf" as const, cmd: "windsurf" },
  { name: "Visual Studio Code - Insiders" as const, cmd: "code-insiders" },
  { name: "Visual Studio Code" as const, cmd: "code" },
  { name: "Cursor" as const, cmd: "cursor" },
  { name: "VSCodium" as const, cmd: "codium" },
]

export namespace Ide {
  const log = Log.create({ service: "ide" })

  /**
   * Key used to register the IDE MCP client in the MCP state. Referenced by
   * mcp/index.ts (to store the client).
   */
  export const IDE_CLIENT_KEY = "vscode"

  export const Event = {
    Installed: BusEvent.define(
      "ide.installed",
      z.object({
        ide: z.string(),
      }),
    ),
    /** Fired when the IDE editor context changes (active file, selection). */
    ContextUpdated: BusEvent.define(
      "ide.context.updated",
      z.object({
        uri: z.string().optional(),
        selection: z
          .object({
            start: z.object({ line: z.number(), column: z.number() }),
            end: z.object({ line: z.number(), column: z.number() }),
            text: z.string(),
          })
          .optional(),
      }),
    ),
  }

  export const AlreadyInstalledError = NamedError.create("AlreadyInstalledError", z.object({}))

  export const InstallFailedError = NamedError.create(
    "InstallFailedError",
    z.object({
      stderr: z.string(),
    }),
  )

  export function ide() {
    if (process.env["TERM_PROGRAM"] === "vscode") {
      const v = process.env["GIT_ASKPASS"]
      for (const ide of SUPPORTED_IDES) {
        if (v?.includes(ide.name)) return ide.name
      }
    }
    return "unknown"
  }

  export function alreadyInstalled() {
    return process.env["OPENCODE_CALLER"] === "vscode" || process.env["OPENCODE_CALLER"] === "vscode-insiders"
  }

  export async function install(ide: (typeof SUPPORTED_IDES)[number]["name"]) {
    const cmd = SUPPORTED_IDES.find((i) => i.name === ide)?.cmd
    if (!cmd) throw new Error(`Unknown IDE: ${ide}`)

    const p = await Process.run([cmd, "--install-extension", "sst-dev.opencode"], {
      nothrow: true,
    })
    const stdout = p.stdout.toString()
    const stderr = p.stderr.toString()

    log.info("installed", {
      ide,
      stdout,
      stderr,
    })

    if (p.code !== 0) {
      throw new InstallFailedError({ stderr })
    }
    if (stdout.includes("already installed")) {
      throw new AlreadyInstalledError({})
    }
  }

  /**
   * Schema for the JSON lock file written by the VS Code extension's MCP server.
   * Using Zod instead of a bare `as` cast so malformed lock files are caught at
   * parse time rather than causing mysterious failures downstream.
   */
  const LockFileSchema = z.object({
    pid: z.number(),
    workspaceFolders: z.array(z.string()),
    authToken: z.string(),
  })

  /**
   * Returned by `discover()` when a live IDE MCP server is found.
   * Contains everything the CLI needs to connect to the server.
   */
  export interface DiscoveryResult {
    port: number
    authToken: string
    workspaceFolders: string[]
  }

  /**
   * Check whether a process with the given pid is currently running.
   *
   * We use `process.kill(pid, 0)` which sends signal 0 — this performs the
   * kernel permission/existence check without actually delivering a signal.
   * It throws ESRCH if the process doesn't exist, and EPERM if the process
   * exists but we don't have permission to signal it (which still means it's
   * alive).
   */
  export function isProcessRunning(pid: number): boolean {
    try {
      process.kill(pid, 0)
      return true
    } catch (err: unknown) {
      // EPERM means the process exists but we can't signal it — still alive
      return typeof err === "object" && err !== null && (err as NodeJS.ErrnoException).code === "EPERM"
    }
  }

  /**
   * Discover a running IDE MCP server by reading the lock file it created.
   *
   * The VS Code extension writes `{ideDir}/{port}.lock` containing the server's
   * pid, auth token, and workspace folders.  This function:
   *
   * 1. Reads `OPENCODE_MCP_PORT` from the environment.  When the CLI is
   *    launched from within the extension, the extension sets this var to the
   *    port its MCP server is listening on.  Without it there is nothing to
   *    discover, so we return null immediately.
   *
   * 2. Reads and parses the corresponding lock file.  A missing or malformed
   *    file means the server never started (or was from a different run), so
   *    we return null.
   *
   * 3. Verifies the pid recorded in the lock file is still alive.  If the
   *    extension process died the lock file is stale, so we delete it and
   *    return null.
   *
   * 4. On success, returns the port, auth token, and workspace folders needed
   *    to connect to the MCP server.
   *
   * @param ideDir - Directory to look for `{port}.lock` files in.
   *                 Normally `{xdgData}/opencode/ide/` in production; callers
   *                 pass a temp dir in tests so the filesystem stays clean.
   */
  export async function discover(ideDir: string): Promise<DiscoveryResult | null> {
    const portStr = process.env["OPENCODE_MCP_PORT"]
    if (!portStr) {
      log.debug("discover: OPENCODE_MCP_PORT not set, skipping IDE MCP discovery")
      return null
    }

    const port = Number(portStr)
    if (!Number.isFinite(port)) {
      log.warn("discover: OPENCODE_MCP_PORT is not a valid number", { portStr })
      return null
    }
    const lockFilePath = path.join(ideDir, `${port}.lock`)

    // Clean up any stale .tmp files left behind if the extension crashed
    // between writeFileSync and renameSync during lock file creation.
    const tmpPath = lockFilePath + ".tmp"
    await fs.unlink(tmpPath).catch(() => {})

    // Read the lock file — if it doesn't exist the server isn't running
    const raw = await fs.readFile(lockFilePath, "utf-8").catch(() => null)
    if (raw === null) {
      log.debug("discover: lock file not found", { lockFilePath })
      return null
    }

    // Parse and validate the lock file against the expected schema.
    // A parse or validation failure means a corrupt/incompatible file.
    const parsed = (() => {
      try {
        return JSON.parse(raw)
      } catch {
        return null
      }
    })()
    const validated = LockFileSchema.safeParse(parsed)
    if (!validated.success) {
      log.warn("discover: lock file is malformed", { lockFilePath, error: validated.error.message })
      return null
    }
    const lockFile = validated.data

    // Check that the IDE process is still alive; clean up the stale file if not
    if (!isProcessRunning(lockFile.pid)) {
      log.debug("discover: stale lock file (pid not running), removing", {
        lockFilePath,
        pid: lockFile.pid,
      })
      await fs.unlink(lockFilePath).catch(() => {})
      return null
    }

    log.info("discover: found live IDE MCP server", {
      port,
      pid: lockFile.pid,
      workspaceFolders: lockFile.workspaceFolders,
    })

    return {
      port,
      authToken: lockFile.authToken,
      workspaceFolders: lockFile.workspaceFolders,
    }
  }

  /**
   * Connects an MCP client to the IDE's MCP server using discovery info.
   * Bypasses the config-driven MCP.create() flow since the IDE server is
   * auto-discovered, not user-configured.
   *
   * The IDE extension's MCP server uses Bearer token auth — the token is
   * written into the lock file at startup and must be sent with every request.
   */
  export async function connectIde(info: DiscoveryResult): Promise<Client> {
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${info.port}`), {
      requestInit: {
        headers: {
          Authorization: `Bearer ${info.authToken}`,
        },
      },
    })
    const client = new Client({
      name: "opencode",
      version: Installation.VERSION,
    })
    await client.connect(transport)
    return client
  }

  /**
   * The current state of the editor, returned as a JSON payload by the
   * `editor://context` MCP resource. This type definition must be kept in sync
   *  with `EditorContext` defined in `sdks/vscode/src/mcp-server.ts`.
   */
  export interface EditorContext {
    /**
     * URI of the focused editor document, if any (e.g. `file:///path/to/file.ts`,
     * `git:///path?ref=HEAD`, `output:channel-name`). All URI schemes are
     * included so that non-file contexts like diff views and output panels are
     * visible to the consumer.
     */
    uri?: string

    /**
     * The highlighted text selection, if any. Absent when there is no active
     * editor or the selection is empty (i.e. just a cursor with no highlighted
     * text).
     */
    selection?: {
      /** Line and column position of the first selected character (inclusive). */
      start: { line: number; column: number }
      /** Line and column position after the last selected character (exclusive). */
      end: { line: number; column: number }
      /** The selected text content. */
      text: string
    }
  }

  /** The MCP resource URI that the IDE extension exposes for editor context. */
  const EDITOR_CONTEXT_URI = "editor://context"

  /** Per-instance editor context, updated in real time by the IDE extension. */
  const state = Instance.state(() => ({ context: {} as EditorContext }))

  /** Returns the current editor context snapshot. */
  export function editorContext(): EditorContext {
    return state().context
  }

  /**
   * Reads the initial editor context and subscribes to live updates.
   * Called once after the IDE MCP client connects. On each resource-updated
   * notification for editor://context, re-reads the resource and updates
   * the stored state.
   *
   * Assumes a single IDE connection at a time. If reconnection is needed
   * (e.g. VS Code restarts), the caller must create a new client and call
   * this function again — it will replace the onclose and notification
   * handlers on the new client.
   */
  export async function subscribeToContext(client: Client): Promise<void> {
    // Read initial state
    await refreshContext(client)

    // Subscribe to updates (MCP protocol requirement before receiving
    // notifications for a specific resource). Non-fatal — we degrade
    // gracefully to "no live updates" while keeping the initial snapshot.
    await client.subscribeResource({ uri: EDITOR_CONTEXT_URI }).catch((err) => {
      log.debug("failed to subscribe to editor context updates", { error: err })
    })

    // Handle resource-updated notifications. Note: setNotificationHandler
    // registers a single handler per schema — calling it again on the same
    // client for ResourceUpdatedNotificationSchema would replace this handler.
    // Safe to call once on each new client after reconnection, but must not
    // be called twice on the same client.
    client.setNotificationHandler(ResourceUpdatedNotificationSchema, async (notification) => {
      if (notification.params.uri === EDITOR_CONTEXT_URI) {
        await refreshContext(client)
      }
    })

    // Clear stored context when the IDE disconnects so stale data is never
    // attached to prompts or shown in the TUI sidebar.
    client.onclose = () => {
      state().context = {}
      Bus.publish(Ide.Event.ContextUpdated, state().context).catch((err) =>
        log.debug("failed to publish context cleared event", { error: err }),
      )
    }
  }

  /**
   * Reads the editor://context resource from the IDE MCP server and updates
   * the in-memory state. Publishes a bus event so the TUI can react.
   */
  async function refreshContext(client: Client): Promise<void> {
    const result = await client.readResource({ uri: EDITOR_CONTEXT_URI }).catch((err) => {
      log.debug("failed to read editor context", { error: err })
      return null
    })
    if (!result) return

    const first = result.contents[0]
    const text = first && "text" in first ? first.text : undefined
    if (typeof text !== "string") return

    const parsed = (() => {
      try {
        return JSON.parse(text)
      } catch {
        return null
      }
    })()
    // Validate against the same Zod schema used for the bus event so
    // malformed data from the IDE extension is rejected at the boundary.
    const validated = Ide.Event.ContextUpdated.properties.safeParse(parsed)
    if (!validated.success) {
      log.debug("editor context failed validation", { error: validated.error.message })
      return
    }
    state().context = validated.data
    // Publish bus event so the TUI sync layer can pick it up
    await Bus.publish(Ide.Event.ContextUpdated, state().context)
  }
}
