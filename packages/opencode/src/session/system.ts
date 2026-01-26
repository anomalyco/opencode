import { Ripgrep } from "../file/ripgrep"
import { Global } from "../global"
import { Filesystem } from "../util/filesystem"
import { Config } from "../config/config"
import { Log } from "../util/log"

import { Instance } from "../project/instance"
import path from "path"
import os from "os"

import PROMPT_ANTHROPIC from "./prompt/anthropic.txt"
import PROMPT_ANTHROPIC_WITHOUT_TODO from "./prompt/qwen.txt"
import PROMPT_BEAST from "./prompt/beast.txt"
import PROMPT_GEMINI from "./prompt/gemini.txt"
import PROMPT_ANTHROPIC_SPOOF from "./prompt/anthropic_spoof.txt"

import PROMPT_CODEX from "./prompt/codex_header.txt"
import type { Provider } from "@/provider/provider"
import { Flag } from "@/flag/flag"

const log = Log.create({ service: "system-prompt" })

// Store resolved memory paths for the write tool to use
let resolvedMemoryPaths: string[] = []

export function getMemoryPaths(): string[] {
  return resolvedMemoryPaths
}

export function addMemoryPath(resolvedPath: string): void {
  if (!resolvedMemoryPaths.includes(resolvedPath)) {
    resolvedMemoryPaths.push(resolvedPath)
  }
}

export function removeMemoryPath(resolvedPath: string): void {
  const index = resolvedMemoryPaths.indexOf(resolvedPath)
  if (index !== -1) {
    resolvedMemoryPaths.splice(index, 1)
  }
}

async function resolveRelativeInstruction(instruction: string): Promise<string[]> {
  if (!Flag.OPENCODE_DISABLE_PROJECT_CONFIG) {
    return Filesystem.globUp(instruction, Instance.directory, Instance.worktree).catch(() => [])
  }
  if (!Flag.OPENCODE_CONFIG_DIR) {
    log.warn(
      `Skipping relative instruction "${instruction}" - no OPENCODE_CONFIG_DIR set while project config is disabled`,
    )
    return []
  }
  return Filesystem.globUp(instruction, Flag.OPENCODE_CONFIG_DIR, Flag.OPENCODE_CONFIG_DIR).catch(() => [])
}

export namespace SystemPrompt {
  export function instructions() {
    return PROMPT_CODEX.trim()
  }

  export function provider(model: Provider.Model) {
    if (model.api.id.includes("gpt-5")) return [PROMPT_CODEX]
    if (model.api.id.includes("gpt-") || model.api.id.includes("o1") || model.api.id.includes("o3"))
      return [PROMPT_BEAST]
    if (model.api.id.includes("gemini-")) return [PROMPT_GEMINI]
    if (model.api.id.includes("claude")) return [PROMPT_ANTHROPIC]
    return [PROMPT_ANTHROPIC_WITHOUT_TODO]
  }

  export async function environment(model: Provider.Model) {
    const project = Instance.project
    return [
      [
        `You are powered by the model named ${model.api.id}. The exact model ID is ${model.providerID}/${model.api.id}`,
        `Here is some useful information about the environment you are running in:`,
        `<env>`,
        `  Working directory: ${Instance.directory}`,
        `  Is directory a git repo: ${project.vcs === "git" ? "yes" : "no"}`,
        `  Platform: ${process.platform}`,
        `  Today's date: ${new Date().toDateString()}`,
        `</env>`,
        `<files>`,
        `  ${
          project.vcs === "git" && false
            ? await Ripgrep.tree({
                cwd: Instance.directory,
                limit: 200,
              })
            : ""
        }`,
        `</files>`,
      ].join("\n"),
    ]
  }

  const LOCAL_RULE_FILES = [
    "AGENTS.md",
    "CLAUDE.md",
    "CONTEXT.md", // deprecated
  ]
  const GLOBAL_RULE_FILES = [path.join(Global.Path.config, "AGENTS.md")]
  if (!Flag.OPENCODE_DISABLE_CLAUDE_CODE_PROMPT) {
    GLOBAL_RULE_FILES.push(path.join(os.homedir(), ".claude", "CLAUDE.md"))
  }

  if (Flag.OPENCODE_CONFIG_DIR) {
    GLOBAL_RULE_FILES.push(path.join(Flag.OPENCODE_CONFIG_DIR, "AGENTS.md"))
  }

  export async function custom() {
    const config = await Config.get()
    const paths = new Set<string>()

    // Only scan local rule files when project discovery is enabled
    if (!Flag.OPENCODE_DISABLE_PROJECT_CONFIG) {
      for (const localRuleFile of LOCAL_RULE_FILES) {
        const matches = await Filesystem.findUp(localRuleFile, Instance.directory, Instance.worktree)
        if (matches.length > 0) {
          matches.forEach((path) => paths.add(path))
          break
        }
      }
    }

    for (const globalRuleFile of GLOBAL_RULE_FILES) {
      if (await Bun.file(globalRuleFile).exists()) {
        paths.add(globalRuleFile)
        break
      }
    }

    const urls: string[] = []
    if (config.instructions) {
      for (let instruction of config.instructions) {
        if (instruction.startsWith("https://") || instruction.startsWith("http://")) {
          urls.push(instruction)
          continue
        }
        if (instruction.startsWith("~/")) {
          instruction = path.join(os.homedir(), instruction.slice(2))
        }
        let matches: string[] = []
        if (path.isAbsolute(instruction)) {
          matches = await Array.fromAsync(
            new Bun.Glob(path.basename(instruction)).scan({
              cwd: path.dirname(instruction),
              absolute: true,
              onlyFiles: true,
            }),
          ).catch(() => [])
        } else {
          matches = await resolveRelativeInstruction(instruction)
        }
        matches.forEach((path) => paths.add(path))
      }
    }

    const foundFiles = Array.from(paths).map((p) =>
      Bun.file(p)
        .text()
        .catch(() => "")
        .then((x) => "Instructions from: " + p + "\n" + x),
    )
    const foundUrls = urls.map((url) =>
      fetch(url, { signal: AbortSignal.timeout(5000) })
        .then((res) => (res.ok ? res.text() : ""))
        .catch(() => "")
        .then((x) => (x ? "Instructions from: " + url + "\n" + x : "")),
    )
    return Promise.all([...foundFiles, ...foundUrls]).then((result) => result.filter(Boolean))
  }

  /**
   * Reads MEMORY.md files before every message.
   * Unlike custom() which runs once at session start, this runs before each API call.
   * The model can also write to these files using the memory_write tool.
   * Always returns memory instructions so the model knows about memory_create.
   */
  export async function memory(): Promise<string[]> {
    const config = await Config.get()
    
    const instructions = [
      "# Memory System",
      "",
      "You have access to a persistent memory system that survives across chat sessions.",
      "",
      "## Tools",
      "- `memory_create`: Create a new memory file for a directory or purpose. Use this when the user asks to remember information about a specific part of the project, or when you discover important context that should persist.",
      "- `memory_write`: Write or append content to an existing memory file.",
      "",
      "## When to create memory files",
      "- When the user explicitly asks to create a memory file or remember something persistently",
      "- When you discover important project conventions, patterns, or decisions that would be useful in future sessions",
      "- When working on a specific subdirectory that has its own context worth remembering",
      "",
      "## Naming convention",
      "- Name files based on the directory or purpose: `api_memory.md`, `frontend_memory.md`, `project_memory.md`",
      "- Use lowercase with underscores",
      "- Always use .md extension",
      "",
    ]

    if (!config.memory || config.memory.length === 0) {
      resolvedMemoryPaths = []
      return [
        [
          ...instructions,
          "## Current status",
          "No memory files are configured yet. Use `memory_create` to create your first memory file.",
        ].join("\n"),
      ]
    }

    const resolvedPaths: string[] = []
    
    for (let memoryPath of config.memory) {
      // Handle ~/ paths
      if (memoryPath.startsWith("~/")) {
        memoryPath = path.join(os.homedir(), memoryPath.slice(2))
      }
      // Handle relative paths (resolve from project directory)
      else if (!path.isAbsolute(memoryPath)) {
        memoryPath = path.join(Instance.directory, memoryPath)
      }
      // Normalize the path
      memoryPath = path.normalize(memoryPath)
      resolvedPaths.push(memoryPath)
    }

    // Store resolved paths for the memory_write tool
    resolvedMemoryPaths = resolvedPaths

    // Read all memory files
    const results: string[] = []
    for (const memoryPath of resolvedPaths) {
      try {
        const file = Bun.file(memoryPath)
        if (await file.exists()) {
          const content = await file.text()
          if (content.trim()) {
            results.push(
              `<memory-file path="${memoryPath}">\n${content}\n</memory-file>`
            )
          }
        }
      } catch (e) {
        log.warn(`Failed to read memory file: ${memoryPath}`, { error: e })
      }
    }

    if (results.length > 0) {
      return [
        [
          ...instructions,
          "## Current memory files",
          "The following memory files are available. Use `memory_write` to update them.",
          "",
          ...results,
        ].join("\n"),
      ]
    }

    return [
      [
        ...instructions,
        "## Current status",
        `${resolvedPaths.length} memory path(s) configured but no files exist yet. Use \`memory_write\` to create content in them or to create a new location.`,
        "",
        "Configured paths:",
        ...resolvedPaths.map(p => `- ${p}`),
      ].join("\n"),
    ]
  }
}
