import { Ripgrep } from "../file/ripgrep"
import { Global } from "../global"
import { Filesystem } from "../util/filesystem"
import { Config } from "../config/config"

import { Instance } from "../project/instance"
import path from "path"
import os from "os"
import * as fs from "fs"

import PROMPT_ANTHROPIC from "./prompt/anthropic.txt"
import PROMPT_ANTHROPIC_WITHOUT_TODO from "./prompt/qwen.txt"
import PROMPT_BEAST from "./prompt/beast.txt"
import PROMPT_GEMINI from "./prompt/gemini.txt"
import PROMPT_ANTHROPIC_SPOOF from "./prompt/anthropic_spoof.txt"
import PROMPT_CODEX from "./prompt/codex.txt"
import type { Provider } from "@/provider/provider"

const PROMPT_CACHE = new Map<string, string>()

function getSystemPromptPaths(): string[] {
  return [
    process.env.OPENCODE_PROMPTS_DIR,
    path.join(Instance.directory, ".opencode", "prompt"),
    path.join(Global.Path.config, "prompt"),
  ].filter(Boolean) as string[]
}

export namespace SystemPrompt {
  export function header(providerID: string) {
    if (providerID.includes("anthropic")) return [PROMPT_ANTHROPIC_SPOOF.trim()]
    return []
  }

  export function provider(model: Provider.Model) {
    const providerId = model.api.id
    const promptFile = getPromptFile(providerId)
    const customPrompt = findCustomPrompt(promptFile)
    if (customPrompt) return [customPrompt]

    if (providerId.includes("gpt-5")) return [PROMPT_CODEX]
    if (providerId.includes("gpt-") || providerId.includes("o1") || providerId.includes("o3"))
      return [PROMPT_BEAST]
    if (providerId.includes("gemini-")) return [PROMPT_GEMINI]
    if (providerId.includes("claude")) return [PROMPT_ANTHROPIC]
    return [PROMPT_ANTHROPIC_WITHOUT_TODO]
  }

  function getPromptFile(modelId: string): string {
    if (modelId.includes("claude")) return "anthropic.txt"
    if (modelId.includes("gpt-5")) return "codex.txt"
    if (modelId.includes("gpt-") || modelId.includes("o1") || modelId.includes("o3"))
      return "beast.txt"
    if (modelId.includes("gemini-")) return "gemini.txt"
    return "qwen.txt"
  }

  function findCustomPrompt(promptFile: string): string | undefined {
    const searchPaths = getSystemPromptPaths()
    for (const searchPath of searchPaths) {
      const fullPath = path.join(searchPath, promptFile)
      const cached = PROMPT_CACHE.get(fullPath)
      if (cached) return cached

      if (fs.existsSync(fullPath)) {
        const content = fs.readFileSync(fullPath, "utf-8")
        PROMPT_CACHE.set(fullPath, content)
        return content
      }
    }
    return undefined
  }

  export async function environment() {
    const project = Instance.project
    return [
      [
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
  const GLOBAL_RULE_FILES = [
    path.join(Global.Path.config, "AGENTS.md"),
    path.join(os.homedir(), ".claude", "CLAUDE.md"),
  ]

  export async function custom() {
    const config = await Config.get()
    const paths = new Set<string>()

    for (const localRuleFile of LOCAL_RULE_FILES) {
      const matches = await Filesystem.findUp(localRuleFile, Instance.directory, Instance.worktree)
      if (matches.length > 0) {
        matches.forEach((path) => paths.add(path))
        break
      }
    }

    for (const globalRuleFile of GLOBAL_RULE_FILES) {
      if (await Bun.file(globalRuleFile).exists()) {
        paths.add(globalRuleFile)
        break
      }
    }

    if (config.instructions) {
      for (let instruction of config.instructions) {
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
          matches = await Filesystem.globUp(instruction, Instance.directory, Instance.worktree).catch(() => [])
        }
        matches.forEach((path) => paths.add(path))
      }
    }

    const found = Array.from(paths).map((p) =>
      Bun.file(p)
        .text()
        .catch(() => "")
        .then((x) => "Instructions from: " + p + "\n" + x),
    )
    return Promise.all(found).then((result) => result.filter(Boolean))
  }
}
