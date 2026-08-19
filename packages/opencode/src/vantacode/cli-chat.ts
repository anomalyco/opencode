/**
 * Native VantaCode chat driver.
 *
 * Wires the reliability-hardened agent loop to REAL tool implementations
 * (read / write / edit / bash / list) plus permission gating, checkpoints,
 * inline diffs, and the Claude-Code-style renderer. Uses Node built-ins only so
 * it runs on the user's machine under Bun or Node without extra deps.
 *
 * Tool output fed back to the model is ALWAYS the real return value of these
 * executors — never model-narrated text (see agent-loop + hallucination-guard).
 */

import fs from "node:fs"
import path from "node:path"
import readline from "node:readline"
import { execFile } from "node:child_process"
import { OllamaClient } from "./ollama.ts"
import { detectHardware, computeTunedSettings } from "./hardware.ts"
import { selectProvider, type VantaConfig, type PermissionMode } from "./config.ts"
import { runAgentLoop, type PermissionGate, type ToolExecutor, type ToolExecutionResult } from "./agent-loop.ts"
import { Renderer } from "./renderer.ts"
import { renderDiff } from "./diff.ts"
import { CheckpointStore } from "./checkpoint.ts"
import type { ToolSchemaDef } from "./tool-validate.ts"

export interface NativeChatOptions {
  readonly config: VantaConfig
  readonly initialMessage?: string
  readonly provider?: string
  readonly model?: string
  readonly host?: string
  readonly permission?: PermissionMode
  readonly stream?: boolean
  readonly debug?: boolean
  /** Working directory for file/shell tools. Defaults to process.cwd(). */
  readonly cwd?: string
}

/** JSON schemas for the built-in tools exposed to the model. */
export const BUILTIN_TOOLS: ToolSchemaDef[] = [
  {
    name: "read_file",
    description: "Read a UTF-8 text file and return its contents.",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "Path to the file, relative to the working directory" } },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description: "Create or overwrite a file with the given contents.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "edit_file",
    description: "Replace an exact string in a file with a new string. The old_string must appear exactly once.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        old_string: { type: "string" },
        new_string: { type: "string" },
      },
      required: ["path", "old_string", "new_string"],
    },
  },
  {
    name: "list_dir",
    description: "List the entries in a directory.",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "Directory path (default: working directory)" } },
      required: [],
    },
  },
  {
    name: "bash",
    description: "Run a shell command and return its combined stdout/stderr. Use for builds, tests, git, etc.",
    parameters: {
      type: "object",
      properties: { command: { type: "string" } },
      required: ["command"],
    },
  },
]

/** Commands that are destructive enough to always require confirmation. */
const DESTRUCTIVE = [/\brm\s+-rf?\b/, /\bgit\s+push\b/, /\bgit\s+reset\s+--hard\b/, /\b(mkfs|dd|shutdown|reboot)\b/, />\s*\/dev\/sd/, /\bsudo\b/]

function isDestructive(command: string): boolean {
  return DESTRUCTIVE.some((re) => re.test(command))
}

function bash(command: string, cwd: string): Promise<ToolExecutionResult> {
  return new Promise((resolve) => {
    execFile("bash", ["-lc", command], { cwd, timeout: 120_000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      const output = `${stdout ?? ""}${stderr ?? ""}`.trim()
      if (err && !output) resolve({ ok: false, output: `Command failed: ${err.message}` })
      else resolve({ ok: !err, output: output || "(no output)" })
    })
  })
}

function makeExecutor(cwd: string, checkpoints: CheckpointStore, renderer: Renderer): ToolExecutor {
  const resolve = (p: string) => path.resolve(cwd, p)
  return {
    async execute(name, args): Promise<ToolExecutionResult> {
      try {
        if (name === "read_file") {
          const file = resolve(String(args.path))
          const content = fs.readFileSync(file, "utf8")
          const clipped = content.length > 20_000 ? `${content.slice(0, 20_000)}\n…(truncated)` : content
          return { ok: true, output: clipped }
        }
        if (name === "write_file") {
          const file = resolve(String(args.path))
          checkpoints.snapshot(file)
          const before = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : ""
          fs.mkdirSync(path.dirname(file), { recursive: true })
          fs.writeFileSync(file, String(args.content), "utf8")
          renderer.diff(renderDiff(before, String(args.content), { path: args.path as string }))
          return { ok: true, output: `Wrote ${file} (${String(args.content).length} bytes)`, filesTouched: [file] }
        }
        if (name === "edit_file") {
          const file = resolve(String(args.path))
          const old = fs.readFileSync(file, "utf8")
          const oldStr = String(args.old_string)
          const occurrences = old.split(oldStr).length - 1
          if (occurrences === 0) return { ok: false, output: `old_string not found in ${args.path}` }
          if (occurrences > 1) return { ok: false, output: `old_string appears ${occurrences} times in ${args.path}; make it unique` }
          checkpoints.snapshot(file)
          const updated = old.replace(oldStr, String(args.new_string))
          fs.writeFileSync(file, updated, "utf8")
          renderer.diff(renderDiff(old, updated, { path: args.path as string }))
          return { ok: true, output: `Edited ${file}`, filesTouched: [file] }
        }
        if (name === "list_dir") {
          const dir = resolve(args.path ? String(args.path) : ".")
          const entries = fs.readdirSync(dir, { withFileTypes: true })
          const listing = entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name)).join("\n")
          return { ok: true, output: listing || "(empty)" }
        }
        if (name === "bash") {
          return await bash(String(args.command), cwd)
        }
        return { ok: false, output: `Unknown tool: ${name}` }
      } catch (error) {
        return { ok: false, output: `Error: ${(error as Error).message}` }
      }
    },
  }
}

function makePermissionGate(mode: PermissionMode, ask: (q: string) => Promise<boolean>): PermissionGate {
  return {
    async check(name, args) {
      if (mode === "yolo") return "allow"
      if (mode === "plan") {
        // Plan mode: read-only operations allowed; mutations denied.
        if (name === "read_file" || name === "list_dir") return "allow"
        if (name === "bash" && !isDestructive(String(args.command))) return "allow"
        return "deny"
      }
      // auto-edit: file edits auto-approved; destructive shell requires confirmation.
      if (name === "bash" && isDestructive(String(args.command))) {
        return (await ask(`Run potentially destructive command? ${String(args.command)}`)) ? "allow" : "deny"
      }
      return "allow"
    },
  }
}

const SYSTEM_PROMPT = `You are VantaCode, a local coding agent. You have these tools: read_file, write_file, edit_file, list_dir, bash.
RULES:
- To change a file you MUST call write_file or edit_file. Never claim you edited a file without calling the tool.
- To run a command you MUST call bash. Never invent command output.
- Only state an outcome after you have seen the real tool result.
- Prefer edit_file over write_file for small changes. Keep going until the task is done, then give a short summary.`

export async function runNativeChat(options: NativeChatOptions): Promise<void> {
  const cwd = options.cwd ?? process.cwd()
  const provider = selectProvider(options.config, options.provider)
  if (!provider) {
    process.stderr.write("No provider configured. Set up ollama or an API key provider.\n")
    process.exit(1)
  }
  if (provider.kind !== "ollama") {
    process.stderr.write(
      `Native chat currently drives local Ollama. Provider "${provider.id}" is an API provider — use the standard 'opencode run' path for it, or select ollama.\n`,
    )
    process.exit(1)
  }

  const host = options.host ?? provider.baseURL
  const model = options.model ?? options.config.defaultModel ?? provider.defaultModel ?? "qwen2.5-coder:7b"
  const client = new OllamaClient({ host, debug: options.debug })
  const renderer = new Renderer()

  if (!(await client.ping())) {
    process.stderr.write(`No Ollama server reachable at ${client.host}. Start it with: ollama serve\n`)
    process.exit(1)
  }

  // Auto-tune options for this machine.
  const hardware = await detectHardware()
  const tuned = computeTunedSettings({ hardware })
  const permissionMode = options.permission ?? options.config.permissionMode

  renderer.status({
    provider: provider.id,
    model,
    gpu: hardware.primaryGpu?.name,
    vramMB: hardware.primaryGpu?.vramTotalMB,
    permissionMode,
  })

  const checkpoints = new CheckpointStore()
  const executor = makeExecutor(cwd, checkpoints, renderer)

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const question = (q: string): Promise<string> => new Promise((resolve) => rl.question(q, resolve))
  const confirm = async (q: string): Promise<boolean> => {
    const answer = await question(`${q} [y/N] `)
    return /^y(es)?$/i.test(answer.trim())
  }
  const gate = makePermissionGate(permissionMode, confirm)

  const runOne = async (message: string) => {
    const result = await runAgentLoop(message, {
      client,
      model,
      tools: BUILTIN_TOOLS,
      executor,
      permission: gate,
      systemPrompt: SYSTEM_PROMPT,
      stream: options.stream ?? true,
      options: { ...tuned.options, temperature: 0 },
      onEvent: (event) => renderer.handle(event),
    })
    checkpoints.commit(message.slice(0, 40))
    if (result.filesTouched.length > 0) renderer.filesSummary(result.filesTouched)
  }

  if (options.initialMessage) {
    await runOne(options.initialMessage)
    rl.close()
    return
  }

  renderer.info("VantaCode chat. Type a message, '/rewind' to undo last turn, or '/exit' to quit.")
  for (;;) {
    const input = (await question("\n› ")).trim()
    if (!input) continue
    if (input === "/exit" || input === "/quit") break
    if (input === "/rewind") {
      const undone = checkpoints.rewindLast()
      if (undone) renderer.info(`Reverted ${undone.restored.length} file(s) from turn "${undone.checkpoint.label}".`)
      else renderer.info("Nothing to rewind.")
      continue
    }
    await runOne(input)
  }
  rl.close()
}
