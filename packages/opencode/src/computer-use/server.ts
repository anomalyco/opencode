/**
 * Computer Use MCP Server — Phase 3 (full security + batch + persistence).
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js"

import { ALL_TOOLS } from "./tools.js"
import { callPythonHelper, ensureBootstrapped, isSupportedPlatform } from "./python-bridge.js"
import type { ScreenshotResult, AppInfo, PermissionStatus } from "./types.js"
import type { AppTier } from "./app-tiers.js"
import {
  getDefaultTierForApp,
  requiredTierForTool,
  tierSatisfies,
  isPolicyDenied,
} from "./app-tiers.js"
import { checkKeyBlocked } from "./key-blocklist.js"
import { loadPersistedGrants, persistFullAccess, persistAppGrant } from "./grants-store.js"
import type { AppGrant } from "./grants-store.js"

const SERVER_NAME = "opencode-computer-use"
const SERVER_VERSION = "0.3.0"

// ── Session state ────────────────────────────────────────────────────

let lastScreenshot: ScreenshotResult | undefined
let fullAccessGranted = false
const appGrants = new Map<string, { tier: AppTier; displayName: string }>()
let grantsLoaded = false

// ── Coordinate scaling ───────────────────────────────────────────────

function scaleCoord(x: number, y: number): { x: number; y: number } {
  if (!lastScreenshot) return { x, y }
  const { width, height, displayWidth, displayHeight, originX, originY } = lastScreenshot
  return {
    x: Math.round((x * displayWidth) / width + originX),
    y: Math.round((y * displayHeight) / height + originY),
  }
}

// ── Permission gates ─────────────────────────────────────────────────

function getMaxGrantedTier(): AppTier {
  if (fullAccessGranted) return "full"
  let max: AppTier = "read"
  for (const grant of appGrants.values()) {
    if (grant.tier === "full") return "full"
    if (grant.tier === "click" && max === "read") max = "click"
  }
  return max
}

async function ensureGrantsLoaded(): Promise<void> {
  if (grantsLoaded) return
  grantsLoaded = true
  try {
    const data = await loadPersistedGrants()
    if (data.fullAccess) fullAccessGranted = true
    for (const app of data.apps) {
      appGrants.set(app.bundleId, { tier: app.tier, displayName: app.displayName })
    }
  } catch {
    // First run, no grants file — that's fine
  }
}

// ── Tool handlers ────────────────────────────────────────────────────

async function handleToolCall(name: string, args: Record<string, unknown>) {
  switch (name) {
    // ── Permission ──────────────────────────────────────────────
    case "request_access": {
      const apps = (args.apps as string[]) || []
      const reason = (args.reason as string) || ""

      // Resolve app names to bundle IDs via running apps list
      const runningApps = await callPythonHelper<AppInfo[]>("list_running_apps", {})
      const results: string[] = []
      const denied: string[] = []

      if (apps.length === 0) {
        fullAccessGranted = true
        await persistFullAccess()
        return {
          content: [{ type: "text" as const, text: "Full access granted for all applications." }],
        }
      }

      for (const appInput of apps) {
        // Find matching running app
        const match = runningApps.find(
          (a) =>
            a.bundleId.toLowerCase() === appInput.toLowerCase() ||
            a.displayName.toLowerCase().includes(appInput.toLowerCase()),
        )
        const bundleId = match?.bundleId || appInput
        const displayName = match?.displayName || appInput

        // Check policy deny
        if (isPolicyDenied(bundleId, displayName)) {
          denied.push(`${displayName} (blocked by policy)`)
          continue
        }

        const tier = getDefaultTierForApp(bundleId, displayName)
        appGrants.set(bundleId, { tier, displayName })
        await persistAppGrant(bundleId, displayName, tier)
        results.push(`${displayName} → tier: ${tier}`)
      }

      let msg = `Access request "${reason}":\n`
      if (results.length) msg += `Granted:\n${results.map((r) => `  ✅ ${r}`).join("\n")}\n`
      if (denied.length) msg += `Denied:\n${denied.map((d) => `  ❌ ${d}`).join("\n")}\n`
      return { content: [{ type: "text" as const, text: msg }] }
    }

    // ── Screenshot ──────────────────────────────────────────────
    case "screenshot": {
      const result = await callPythonHelper<ScreenshotResult>("screenshot", {
        displayId: args.display_id ?? null,
      })
      lastScreenshot = result
      return {
        content: [
          { type: "image" as const, data: result.base64, mimeType: "image/jpeg" },
          { type: "text" as const, text: `Screenshot: ${result.width}x${result.height}px (display: ${result.displayWidth}x${result.displayHeight})` },
        ],
      }
    }

    case "zoom": {
      const result = await callPythonHelper<ScreenshotResult>("zoom", {
        x: args.x, y: args.y, width: args.width, height: args.height,
      })
      return {
        content: [
          { type: "image" as const, data: result.base64, mimeType: "image/jpeg" },
          { type: "text" as const, text: `Region: ${result.width}x${result.height}px` },
        ],
      }
    }

    // ── Mouse ───────────────────────────────────────────────────
    case "left_click": {
      const [cx, cy] = args.coordinate as [number, number]
      const { x, y } = scaleCoord(cx, cy)
      await callPythonHelper("click", { x, y, button: "left", count: 1 })
      return { content: [{ type: "text" as const, text: `Clicked at (${cx}, ${cy})` }] }
    }

    case "double_click": {
      const [cx, cy] = args.coordinate as [number, number]
      const { x, y } = scaleCoord(cx, cy)
      await callPythonHelper("click", { x, y, button: "left", count: 2 })
      return { content: [{ type: "text" as const, text: `Double-clicked at (${cx}, ${cy})` }] }
    }

    case "right_click": {
      const [cx, cy] = args.coordinate as [number, number]
      const { x, y } = scaleCoord(cx, cy)
      await callPythonHelper("click", { x, y, button: "right", count: 1 })
      return { content: [{ type: "text" as const, text: `Right-clicked at (${cx}, ${cy})` }] }
    }

    case "drag": {
      const to = args.to as [number, number]
      const from = args.from as [number, number] | undefined
      const scaledTo = scaleCoord(to[0], to[1])
      const scaledFrom = from ? scaleCoord(from[0], from[1]) : undefined
      await callPythonHelper("drag", {
        from: scaledFrom ? { x: scaledFrom.x, y: scaledFrom.y } : undefined,
        to: { x: scaledTo.x, y: scaledTo.y },
      })
      return { content: [{ type: "text" as const, text: `Dragged to (${to[0]}, ${to[1]})` }] }
    }

    case "scroll": {
      const [cx, cy] = args.coordinate as [number, number]
      const { x, y } = scaleCoord(cx, cy)
      await callPythonHelper("scroll", { x, y, deltaX: args.deltaX || 0, deltaY: args.deltaY || 0 })
      return { content: [{ type: "text" as const, text: `Scrolled at (${cx}, ${cy})` }] }
    }

    // ── Keyboard ────────────────────────────────────────────────
    case "type": {
      const text = (args.text as string) || ""
      if (text.length > 20) {
        await callPythonHelper("type_via_clipboard", { text })
      } else {
        await callPythonHelper("type", { text })
      }
      return { content: [{ type: "text" as const, text: `Typed: ${text.length > 50 ? text.slice(0, 50) + '...' : text}` }] }
    }

    case "key": {
      const keySeq = (args.text as string) || ""

      // Shortcut blocklist check
      const keyCheck = checkKeyBlocked(keySeq)
      if (keyCheck.blocked) {
        return {
          content: [{ type: "text" as const, text: keyCheck.reason! }],
          isError: true,
        }
      }

      await callPythonHelper("key", { keySequence: keySeq })
      return { content: [{ type: "text" as const, text: `Pressed: ${keySeq}` }] }
    }

    // ── App management ──────────────────────────────────────────
    case "list_running_apps": {
      const apps = await callPythonHelper<AppInfo[]>("list_running_apps", {})
      const appList = apps.map((a) => `${a.displayName} (${a.bundleId})`).join("\n")
      return { content: [{ type: "text" as const, text: `Running apps:\n${appList}` }] }
    }

    case "open_app": {
      await callPythonHelper("open_app", { bundleId: args.bundle_id })
      return { content: [{ type: "text" as const, text: `Opened: ${args.bundle_id}` }] }
    }

    // ── Clipboard ───────────────────────────────────────────────
    case "read_clipboard": {
      const text = await callPythonHelper<string>("read_clipboard", {})
      return { content: [{ type: "text" as const, text: text || "(clipboard is empty)" }] }
    }

    // ── Batch ────────────────────────────────────────────────────
    case "computer_batch": {
      const actions = args.actions as Array<{ tool: string; args?: Record<string, unknown> }>
      const results: string[] = []
      for (let i = 0; i < actions.length; i++) {
        const action = actions[i]
        try {
          const result = await handleToolCall(action.tool, action.args ?? {})
          const text = result.content
            .filter((c: any) => c.type === "text")
            .map((c: any) => c.text)
            .join("; ")
          results.push(`[${i + 1}] ${action.tool}: ${text}`)
        } catch (err) {
          results.push(`[${i + 1}] ${action.tool}: ERROR - ${err instanceof Error ? err.message : String(err)}`)
        }
      }
      // Auto-screenshot after batch
      try {
        const ss = await callPythonHelper<ScreenshotResult>("screenshot", { displayId: null })
        lastScreenshot = ss
        return {
          content: [
            { type: "text" as const, text: results.join("\n") },
            { type: "image" as const, data: ss.base64, mimeType: "image/jpeg" },
          ],
        }
      } catch {
        return { content: [{ type: "text" as const, text: results.join("\n") }] }
      }
    }

    default:
      return { content: [{ type: "text" as const, text: `Unknown tool: ${name}` }], isError: true }
  }
}

// ── Server creation ──────────────────────────────────────────────────

export function createComputerUseServer(): Server {
  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} } },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    if (!isSupportedPlatform()) return { tools: [] }
    return { tools: ALL_TOOLS }
  })

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params
    const toolArgs = (args ?? {}) as Record<string, unknown>

    try {
      if (!isSupportedPlatform()) {
        return { content: [{ type: "text" as const, text: "Computer Use is only supported on macOS." }], isError: true }
      }

      await ensureBootstrapped()
      await ensureGrantsLoaded()

      // Gate: check tier-based permission for action tools (skip request_access itself)
      if (name !== "request_access") {
      const required = requiredTierForTool(name)
      if (required !== "read") {
        const granted = getMaxGrantedTier()
        if (!tierSatisfies(granted, required)) {
          const needed = required === "click" ? "at least click-level" : "full"
          return {
            content: [{ type: "text" as const, text: `Permission denied: "${name}" requires ${needed} access. Call request_access first.` }],
            isError: true,
          }
          }
      }
      } // end request_access bypass

      return await handleToolCall(name, toolArgs)
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Computer Use error: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      }
    }
  })

  return server
}

export async function startServer(): Promise<void> {
  const server = createComputerUseServer()
  const transport = new StdioServerTransport()
  await server.connect(transport)
}
