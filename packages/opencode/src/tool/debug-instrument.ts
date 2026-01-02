import z from "zod"
import { Tool } from "./tool"
import { Log } from "../util/log"
import { Instance } from "../project/instance"
import { DebugServer } from "../debug"
import { Identifier } from "../id/id"
import fs from "fs/promises"
import path from "path"

const log = Log.create({ service: "debug-instrument" })

const DESCRIPTION = `
RUNTIME DEBUG TOOL - Use this FIRST for any runtime/browser issue.

CRITICAL: DO NOT GUESS. Instrument and collect data FIRST.

OPTIONS (pick what you need):
- network: true  → Auto-log ALL fetch calls (method, url, status, ms)
- console: true  → Capture console.log/warn/error
- errors: true   → Catch window errors + unhandled rejections
- perf: true     → Adds __oc_start("label") / __oc_end("label") timing helpers
- react: true    → Adds __oc_render("Component", props) / __oc_state("Comp", "name", value)

EXAMPLE SUMMARY OUTPUT:
  === Debug Summary (156 logs over 8.2s) ===

  [NET]: 12x (3 unique msgs)
    - "POST /api/chat"
    - "GET /api/user"
    status: 200 → 500, ms: 45 → 890

  [RENDER]: 47x
    - "FloatingChatbot"
    count: 1 → 47

  [STATE]: 23x
    - "FloatingChatbot.messages"
    - "FloatingChatbot.isOpen"

  [CONSOLE]: 8x (2 unique msgs)
    - "log"
    - "error"

  [ERROR]: 1x
    - "Cannot read property 'scroll' of null"

MANUAL LOGS (add these in code):
  __oc_log("file.tsx:42", "description", { vars }, "A")

PERF TIMING (when perf:true):
  __oc_start("apiCall");
  await fetch(...);
  __oc_end("apiCall", { endpoint });

REACT HELPERS (when react:true):
  // At top of component:
  __oc_render("MyComponent", props);
  // After useState:
  __oc_state("MyComponent", "count", count);

WORKFLOW:
1. debug_instrument with options you need
2. Edit to add snippet + manual logs
3. Tell user steps to reproduce
4. debug_watch to collect summary
5. debug_cleanup when done
`.trim()

// Track instrumented files for cleanup
const instrumentedFiles = Instance.state(() => {
  return new Map<string, { original: string; language: string }>()
})

export const DebugInstrumentTool = Tool.define("debug_instrument", async () => {
  return {
    description: DESCRIPTION,
    parameters: z.object({
      file_path: z.string().describe("Absolute path to the file to instrument"),
      session_id: z.string().optional().describe("Debug session ID. If not provided, a new session will be created."),
      network: z.boolean().optional().default(false).describe("Auto-log ALL fetch calls (method, url, status, timing)"),
      console: z.boolean().optional().default(false).describe("Capture all console.log/warn/error output"),
      errors: z.boolean().optional().default(false).describe("Catch window.onerror and unhandled promise rejections"),
      perf: z.boolean().optional().default(false).describe("Add __oc_start/__oc_end timing helpers"),
      react: z.boolean().optional().default(false).describe("Add __oc_render/__oc_state helpers for React components"),
    }),
    async execute(params) {
      const filePath = params.file_path
      const ext = path.extname(filePath).toLowerCase()

      // Determine language
      let language: "javascript" | "typescript" | "python"
      if ([".js", ".jsx", ".mjs", ".cjs"].includes(ext)) {
        language = "javascript"
      } else if ([".ts", ".tsx", ".mts", ".cts"].includes(ext)) {
        language = "typescript"
      } else if ([".py"].includes(ext)) {
        language = "python"
      } else {
        throw new Error(`Unsupported file type '${ext}'. Supported: .js, .ts, .jsx, .tsx, .py`)
      }

      // Read and store original file for cleanup
      let content: string
      try {
        content = await fs.readFile(filePath, "utf-8")
      } catch (e) {
        throw new Error(`Could not read file '${filePath}'`)
      }

      const tracked = instrumentedFiles()
      tracked.set(filePath, { original: content, language })

      // Generate/get session ID
      const sessionID = params.session_id ?? Identifier.ascending("debug")
      if (!DebugServer.isActive(sessionID)) {
        DebugServer.startSession(sessionID)
      }

      // Get the client snippet
      const clientSnippet = DebugServer.getClientSnippet(language, sessionID, {
        network: params.network,
        console: params.console,
        errors: params.errors,
        perf: params.perf,
        react: params.react,
      })

      const fileName = path.basename(filePath)

      log.info("Debug snippet generated", { filePath, language, sessionID })

      return {
        title: `Debug: ${fileName}`,
        metadata: {
          filePath,
          language,
          sessionID,
        },
        output: `Session: ${sessionID}

⚠️  PLACEMENT IS CRITICAL - READ THE FILE FIRST ⚠️

Before using Edit, you MUST:
1. Read the file to find the LAST import statement
2. Find the line number of that last import
3. Place snippet on the line AFTER that import

CORRECT placement example:
\`\`\`
import React from "react";
import { useState } from "react";
import "./styles.css";            // ← This is line 3, the LAST import

${clientSnippet}   // ← Place snippet HERE on line 4

export function MyComponent() {   // ← Component starts AFTER snippet
\`\`\`

WRONG placement (will break the file):
\`\`\`
${clientSnippet}   // ❌ WRONG - before imports
import React from "react";
\`\`\`

SNIPPET TO ADD:
${clientSnippet}

After adding snippet, add manual logs like:
// #region agent-log
__oc_log("${fileName}:LINE", "description", { varName }, "A");
// #endregion

Then run: debug_watch session_id="${sessionID}"`,
      }
    },
  }
})

// Export for cleanup tool
export function getInstrumentedFiles() {
  return instrumentedFiles()
}
