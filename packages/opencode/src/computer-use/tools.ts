/**
 * Tool definitions for Computer Use MCP server.
 *
 * Phase 2: full operation set — screenshot, zoom, click, type, key,
 * scroll, drag, app management, clipboard, and request_access.
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js"

const coordinateDesc =
  "Coordinate pair [x, y] in the screenshot's pixel space. " +
  "x increases rightward, y increases downward. Origin (0,0) is the top-left corner."

// ── Permission ──────────────────────────────────────────────────────

const REQUEST_ACCESS_TOOL: Tool = {
  name: "request_access",
  description:
    "Request user permission to interact with desktop applications. " +
    "ALWAYS call this before any click/type/key/drag operation. " +
    "The user will see a dialog listing the apps you want to control and must approve.",
  inputSchema: {
    type: "object" as const,
    properties: {
      apps: {
        type: "array",
        items: { type: "string" },
        description: "Application display names or bundle IDs to request access to.",
      },
      reason: {
        type: "string",
        description: "One-sentence explanation shown in the approval dialog.",
      },
    },
    required: ["apps", "reason"],
  },
}

// ── Screenshot ───────────────────────────────────────────────────────

const SCREENSHOT_TOOL: Tool = {
  name: "screenshot",
  description:
    "Take a screenshot of the primary display. " +
    "Returns a base64-encoded JPEG image showing the current screen state. " +
    "Use this to see what is on screen before taking actions.",
  inputSchema: {
    type: "object" as const,
    properties: {
      display_id: {
        type: "number",
        description: "Display ID to capture. Defaults to the primary display.",
      },
    },
  },
}

const ZOOM_TOOL: Tool = {
  name: "zoom",
  description:
    "Take a higher-resolution screenshot of a specific screen region. " +
    "Useful for reading small text or inspecting UI details.",
  inputSchema: {
    type: "object" as const,
    properties: {
      x: { type: "number", description: "Left edge (logical pixels)." },
      y: { type: "number", description: "Top edge (logical pixels)." },
      width: { type: "number", description: "Width (logical pixels)." },
      height: { type: "number", description: "Height (logical pixels)." },
    },
    required: ["x", "y", "width", "height"],
  },
}

// ── Mouse ────────────────────────────────────────────────────────────

const CLICK_TOOL: Tool = {
  name: "left_click",
  description: `Click the mouse at the specified coordinates. ${coordinateDesc}`,
  inputSchema: {
    type: "object" as const,
    properties: {
      coordinate: {
        type: "array",
        items: { type: "number" },
        minItems: 2,
        maxItems: 2,
        description: "[x, y] position to click.",
      },
    },
    required: ["coordinate"],
  },
}

const DOUBLE_CLICK_TOOL: Tool = {
  name: "double_click",
  description: `Double-click the mouse at the specified coordinates. ${coordinateDesc}`,
  inputSchema: {
    type: "object" as const,
    properties: {
      coordinate: {
        type: "array",
        items: { type: "number" },
        minItems: 2,
        maxItems: 2,
        description: "[x, y] position to double-click.",
      },
    },
    required: ["coordinate"],
  },
}

const RIGHT_CLICK_TOOL: Tool = {
  name: "right_click",
  description: `Right-click the mouse at the specified coordinates. ${coordinateDesc}`,
  inputSchema: {
    type: "object" as const,
    properties: {
      coordinate: {
        type: "array",
        items: { type: "number" },
        minItems: 2,
        maxItems: 2,
        description: "[x, y] position to right-click.",
      },
    },
    required: ["coordinate"],
  },
}

const DRAG_TOOL: Tool = {
  name: "drag",
  description:
    "Drag from one coordinate to another. Hold the left mouse button at the start coordinate, " +
    "move to the end coordinate, then release.",
  inputSchema: {
    type: "object" as const,
    properties: {
      from: {
        type: "array",
        items: { type: "number" },
        minItems: 2,
        maxItems: 2,
        description: "[x, y] start position.",
      },
      to: {
        type: "array",
        items: { type: "number" },
        minItems: 2,
        maxItems: 2,
        description: "[x, y] end position.",
      },
    },
    required: ["to"],
  },
}

const SCROLL_TOOL: Tool = {
  name: "scroll",
  description:
    "Scroll the mouse wheel at the specified coordinates. " +
    "Positive deltaY scrolls up, negative scrolls down. Positive deltaX scrolls right.",
  inputSchema: {
    type: "object" as const,
    properties: {
      coordinate: {
        type: "array",
        items: { type: "number" },
        minItems: 2,
        maxItems: 2,
        description: "[x, y] position to scroll at.",
      },
      deltaX: { type: "number", description: "Horizontal scroll amount (default 0)." },
      deltaY: { type: "number", description: "Vertical scroll amount (default 0)." },
    },
    required: ["coordinate", "deltaX", "deltaY"],
  },
}

// ── Keyboard ─────────────────────────────────────────────────────────

const TYPE_TOOL: Tool = {
  name: "type",
  description:
    "Type a string of text at the current cursor position. " +
    "The text is typed character by character. For long text, use the clipboard path automatically.",
  inputSchema: {
    type: "object" as const,
    properties: {
      text: { type: "string", description: "The text to type." },
    },
    required: ["text"],
  },
}

const KEY_TOOL: Tool = {
  name: "key",
  description:
    "Press a key or key combination. Keys are joined with '+'. " +
    "Examples: 'return', 'command+c', 'command+shift+3', 'up'. " +
    "Common keys: return, tab, escape, delete, up, down, left, right, space, command, ctrl, shift, option.",
  inputSchema: {
    type: "object" as const,
    properties: {
      text: { type: "string", description: "Key sequence, e.g. 'command+c' or 'return'." },
    },
    required: ["text"],
  },
}

// ── App management ───────────────────────────────────────────────────

const LIST_RUNNING_APPS_TOOL: Tool = {
  name: "list_running_apps",
  description: "List all currently running applications.",
  inputSchema: { type: "object" as const, properties: {} },
}

const OPEN_APP_TOOL: Tool = {
  name: "open_app",
  description: "Open an application by its bundle ID or display name.",
  inputSchema: {
    type: "object" as const,
    properties: {
      bundle_id: { type: "string", description: "Bundle ID, e.g. 'com.apple.Safari'." },
    },
    required: ["bundle_id"],
  },
}

// ── Clipboard ────────────────────────────────────────────────────────

const READ_CLIPBOARD_TOOL: Tool = {
  name: "read_clipboard",
  description: "Read the current contents of the system clipboard.",
  inputSchema: { type: "object" as const, properties: {} },
}

// ── All tools ────────────────────────────────────────────────────────

export const COMPUTER_USE_TOOLS: Tool[] = [
  REQUEST_ACCESS_TOOL,
  SCREENSHOT_TOOL,
  ZOOM_TOOL,
  CLICK_TOOL,
  DOUBLE_CLICK_TOOL,
  RIGHT_CLICK_TOOL,
  DRAG_TOOL,
  SCROLL_TOOL,
  TYPE_TOOL,
  KEY_TOOL,
  LIST_RUNNING_APPS_TOOL,
  OPEN_APP_TOOL,
  READ_CLIPBOARD_TOOL,
]

// ── Batch ────────────────────────────────────────────────────────────

const BATCH_TOOL: Tool = {
  name: "computer_batch",
  description:
    "Execute multiple computer-use actions in a single call. " +
    "Each action is an object with 'tool' (name) and 'args' (parameters). " +
    "Actions execute sequentially. A screenshot is taken after all actions complete. " +
    "Use this to reduce round-trips when performing multi-step UI operations.",
  inputSchema: {
    type: "object" as const,
    properties: {
      actions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            tool: { type: "string", description: "Tool name, e.g. 'left_click', 'type', 'key'." },
            args: {
              type: "object",
              description: "Arguments for the tool, matching its individual schema.",
            },
          },
          required: ["tool"],
        },
        description: "Array of actions to execute sequentially.",
      },
    },
    required: ["actions"],
  },
}

/** All tools including batch. */
export const ALL_TOOLS: Tool[] = [...COMPUTER_USE_TOOLS, BATCH_TOOL]
