import { Ripgrep } from "../file/ripgrep"

import { Instance } from "../project/instance"

import PROMPT_ANTHROPIC from "./prompt/anthropic.txt"
import PROMPT_ANTHROPIC_WITHOUT_TODO from "./prompt/qwen.txt"
import PROMPT_BEAST from "./prompt/beast.txt"
import PROMPT_GEMINI from "./prompt/gemini.txt"

import PROMPT_CODEX from "./prompt/codex_header.txt"
import PROMPT_TRINITY from "./prompt/trinity.txt"
import type { Provider } from "@/provider/provider"

const UNIVER_SDK_GUIDE = `# Veritly Univer Python SDK (pyodide tool)

Spreadsheet must be open in this tab. \`from veritly_univer_sdk import RangeRect, UniverSDK, sdk_help\`.

**First step when unsure:** \`print(sdk_help())\` or \`help(UniverSDK)\`.

## Pyodide rules (critical)

- \`async def main(): ...\` only — the tool runs \`main\` for you.
- **Never** \`asyncio.run(main())\` (running event loop error).
- \`await UniverSDK().connect()\` — in-page bridge, no relay.

## Common calls

- Read block: \`await sdk.get_sheet(max_row=100, max_col=20)\` or \`get_range(RangeRect.block(99, 9), sheet_id=doc.sheetId)\`
- Write: \`await sdk.set_range(RangeRect(0,0,0,1), [["a","b"]], sheet_id=doc.sheetId)\`
- Chart: \`await sdk.add_chart(range_rect, sheet_id=doc.sheetId, chart_type=4)\` — \`chart_type\` is int (4=bar), not string; one range for data; no \`title\`

## Relay / MCP (not pyodide)

Only if using CPython + WebSocket: relay + VITE_UNIVER_SDK_WS; \`asyncio.run(main())\` OK there.`

export namespace SystemPrompt {
  export function instructions() {
    return PROMPT_CODEX.trim()
  }

  export function hosted() {
    if (!process.env.PUBLIC_BASE_URL?.trim()) return []

    const lines = [
      "The pyodide tool runs Python in the user's browser (Pyodide / WASM), not on the API container.",
      "Paths and workdir are checked against $WORKSPACE for permissions only; execution has no server-side filesystem.",
      "The pyodide tool loads veritly_univer_sdk in the browser (in-page bridge when a spreadsheet is open).",
      "In pyodide snippets: never use asyncio.run(); use async def main only. If unsure about the API, print(sdk_help()) first.",
      "",
      ...UNIVER_SDK_GUIDE.split("\n"),
    ]

    if (process.env.UNIVER_SDK_WS?.trim() || process.env.VITE_UNIVER_SDK_WS?.trim()) {
      lines.push(
        "VITE_UNIVER_SDK_WS / UNIVER_SDK_WS configure the relay for external agents (MCP); Pyodide in the tab does not use them.",
      )
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
