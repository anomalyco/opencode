import { Ripgrep } from "../file/ripgrep"

import { Instance } from "../project/instance"

import PROMPT_ANTHROPIC from "./prompt/anthropic.txt"
import PROMPT_ANTHROPIC_WITHOUT_TODO from "./prompt/qwen.txt"
import PROMPT_BEAST from "./prompt/beast.txt"
import PROMPT_GEMINI from "./prompt/gemini.txt"

import PROMPT_CODEX from "./prompt/codex_header.txt"
import PROMPT_TRINITY from "./prompt/trinity.txt"
import type { Provider } from "@/provider/provider"

const UNIVER_SDK_GUIDE = `# Veritly Univer Python SDK

The SDK talks to a local Bun relay that bridges agent WebSocket clients to the browser tab running Univer. The app must set VITE_UNIVER_SDK_WS so the viewer connects as role=browser; agents use role=agent (added automatically by the SDK).

## Prerequisites

1. Relay running on the same machine as OpenCode. Default listen: ws://127.0.0.1:18766/ws (port from UNIVER_SDK_PORT, default 18766).
2. Browser session with a spreadsheet open and connected to the relay (otherwise agent requests have no peer).
3. Python with websockets installed.

### Python import: hosted vs local

- Hosted / Docker: The image runs pip install on packages/univer-sdk/python at build time. python3 can import veritly_univer_sdk with no extra steps.
- Local dev: Run bash packages/univer-sdk/python/install-local.sh once.

## Default URL and environment

| Variable | Purpose |
|-----------|---------|
| UNIVER_SDK_WS | Full WebSocket URL (e.g. ws://127.0.0.1:18766/ws). Overrides host/port defaults. |
| UNIVER_SDK_PORT | Used only when UNIVER_SDK_WS is unset: builds ws://127.0.0.1:{port}/ws (default port 18766). |

UniverSDK() with no arguments uses the above. Pass an explicit URL only when needed:

UniverSDK("ws://127.0.0.1:18766/ws")

## Quick start

import asyncio
from veritly_univer_sdk import RangeRect, UniverSDK

async def main() -> None:
    sdk = UniverSDK()
    await sdk.connect()
    try:
        doc = await sdk.get_active_document()
        rows = await sdk.get_range(
            RangeRect(startRow=0, endRow=10, startColumn=0, endColumn=2),
            sheet_id=doc.sheetId,
        )
        print(rows)
        await sdk.set_range(
            RangeRect(startRow=0, endRow=0, startColumn=0, endColumn=1),
            [["Hello"]],
            sheet_id=doc.sheetId,
        )
    finally:
        await sdk.close()

asyncio.run(main())

## Operations (relay op names)

| Python method | op | Notes |
|---------------|---|-------|
| get_active_document() | get_active_document | unitId, sheetId, sheetName |
| list_sheets() | list_sheets | |
| get_range(...) | get_range | Inclusive row/column indices |
| set_range(...) | set_range | 2D values matrix |
| add_chart(...) | add_chart | Optional chart_type, anchor |
| inspect_facade(...) | sdk_introspect | Lists facade method names |
| execute_command(id, params) | execute_command | Raw univerAPI.executeCommand |

## Charts and advanced mutations

add_chart uses Univer's insert-chart path. For drawing-level commands, use execute_command with the command id and params your app supports.

## Troubleshooting

- UniverSDK is not connected: call await sdk.connect() before other methods.
- Relay errors / timeout: ensure relay is up, port matches UNIVER_SDK_WS / UNIVER_SDK_PORT, and the spreadsheet tab is open with VITE_UNIVER_SDK_WS pointing at the relay.
- Multi-host: set UNIVER_SDK_WS to the reachable WebSocket URL for that instance; browser and agent must reach the same relay.`

export namespace SystemPrompt {
  export function instructions() {
    return PROMPT_CODEX.trim()
  }

  export function hosted() {
    if (!process.env.VERITLY_EXECUTOR_URL?.trim()) return []

    const lines = [
      "Shell commands run inside an isolated executor workspace, not on the API container.",
      "The shell workspace path is exposed as $WORKSPACE.",
      "Python 3 is available there.",
      "The Python package veritly_univer_sdk is installed there.",
      "For Univer automation, import from veritly_univer_sdk, for example: from veritly_univer_sdk import RangeRect, UniverSDK",
      "",
      ...UNIVER_SDK_GUIDE.split("\n"),
    ]

    if (process.env.UNIVER_SDK_WS?.trim() || process.env.VITE_UNIVER_SDK_WS?.trim()) {
      lines.push("The executor shell environment includes UNIVER_SDK_WS when relay connectivity is configured.")
    }

    return lines
  }

  export function provider(model: Provider.Model) {
    if (model.api.id.includes("gpt-5")) return [PROMPT_CODEX]
    if (model.api.id.includes("gpt-") || model.api.id.includes("o1") || model.api.id.includes("o3"))
      return [PROMPT_BEAST]
    if (model.api.id.includes("gemini-")) return [PROMPT_GEMINI]
    if (model.api.id.includes("claude")) return [PROMPT_ANTHROPIC]
    if (model.api.id.toLowerCase().includes("trinity")) return [PROMPT_TRINITY]
    return [PROMPT_ANTHROPIC_WITHOUT_TODO]
  }

  export async function environment(model: Provider.Model) {
    const project = Instance.project
    const extra = hosted()
    return [
      [
        `You are powered by the model named ${model.api.id}. The exact model ID is ${model.providerID}/${model.api.id}`,
        `Here is some useful information about the environment you are running in:`,
        `<env>`,
        `  Working directory: ${Instance.workspace}`,
        `  Workspace root folder: ${Instance.workspace}`,
        `  Is directory a git repo: ${project.vcs === "git" ? "yes" : "no"}`,
        `  Platform: ${process.platform}`,
        `  Today's date: ${new Date().toDateString()}`,
        `</env>`,
        `<directories>`,
        `  ${
          project.vcs === "git" && false
            ? await Ripgrep.tree({
                cwd: Instance.workspace,
                limit: 50,
              })
            : ""
        }`,
        `</directories>`,
        ...(extra.length ? [`<runtime>`, ...extra.map((line) => `  ${line}`), `</runtime>`] : []),
      ].join("\n"),
    ]
  }
}
