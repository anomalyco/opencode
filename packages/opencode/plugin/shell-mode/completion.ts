/**
 * Shell completion utilities.
 * Provides tab completion for shell commands and file paths.
 */

import { spawn } from "child_process"
import path from "path"
import os from "os"
import fs from "fs"
import { Shell } from "@/shell/shell"
import { getCwd } from "./cwd"

export type CompletionResult = {
  completions: string[]
  type: "command" | "file" | "mixed"
  prefix: string
  replaceFrom: number
  replaceTo: number
}

/**
 * Get completions for the current input.
 * Uses the user's default shell to provide completions.
 */
export async function getCompletions(
  input: string,
  cursorPosition: number,
  cwd?: string
): Promise<CompletionResult> {
  const workingDir = cwd ?? getCwd()
  const inputUpToCursor = input.slice(0, cursorPosition)

  // Parse the input to find what we're completing
  const { word, wordStart, isFirstWord } = parseInputForCompletion(inputUpToCursor)

  // Expand ~ in the word for file completion
  const expandedWord = expandTilde(word)

  if (isFirstWord) {
    // Complete commands
    const completions = await getCommandCompletions(word, workingDir)
    return {
      completions,
      type: "command",
      prefix: word,
      replaceFrom: wordStart,
      replaceTo: cursorPosition,
    }
  } else {
    // Complete file paths
    const completions = await getFileCompletions(expandedWord, workingDir)
    // If the original word started with ~, adjust completions to keep ~
    const adjustedCompletions =
      word.startsWith("~") && !word.startsWith("~")
        ? completions
        : word.startsWith("~")
          ? completions.map((c) => collapseTilde(c))
          : completions

    return {
      completions: adjustedCompletions,
      type: "file",
      prefix: word,
      replaceFrom: wordStart,
      replaceTo: cursorPosition,
    }
  }
}

/**
 * Parse input to find the word being completed.
 */
function parseInputForCompletion(input: string): {
  word: string
  wordStart: number
  isFirstWord: boolean
} {
  // Handle empty input
  if (!input || input.length === 0) {
    return { word: "", wordStart: 0, isFirstWord: true }
  }

  // Find the start of the current word, handling quotes and escapes
  let wordStart = input.length
  let inSingleQuote = false
  let inDoubleQuote = false
  let escaped = false

  for (let i = input.length - 1; i >= 0; i--) {
    const char = input[i]

    if (escaped) {
      escaped = false
      continue
    }

    if (char === "\\") {
      escaped = true
      continue
    }

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote
      continue
    }

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote
      continue
    }

    // If we hit a space (not in quotes), we found word boundary
    if (char === " " && !inSingleQuote && !inDoubleQuote) {
      wordStart = i + 1
      break
    }

    // Also break on special shell characters that start new arguments
    if (
      !inSingleQuote &&
      !inDoubleQuote &&
      (char === "|" || char === ";" || char === "&" || char === ">" || char === "<" || char === "(" || char === ")")
    ) {
      wordStart = i + 1
      break
    }
  }

  if (wordStart > input.length) {
    wordStart = input.length
  }

  const word = input.slice(wordStart)

  // Determine if this is the first word (command position)
  // Look at the input before wordStart to see if there's any non-whitespace content
  const beforeWord = input.slice(0, wordStart).trim()
  const isFirstWord =
    beforeWord.length === 0 ||
    beforeWord.endsWith("|") ||
    beforeWord.endsWith(";") ||
    beforeWord.endsWith("&&") ||
    beforeWord.endsWith("||")

  return { word, wordStart, isFirstWord }
}

/**
 * Expand ~ to home directory.
 */
function expandTilde(p: string): string {
  if (p.startsWith("~/")) {
    return path.join(os.homedir(), p.slice(2))
  }
  if (p === "~") {
    return os.homedir()
  }
  return p
}

/**
 * Collapse home directory to ~.
 */
function collapseTilde(p: string): string {
  const home = os.homedir()
  if (p.startsWith(home + "/")) {
    return "~" + p.slice(home.length)
  }
  if (p === home) {
    return "~"
  }
  return p
}

/**
 * Get command completions using the shell's completion system.
 */
async function getCommandCompletions(prefix: string, cwd: string): Promise<string[]> {
  const shellPath = Shell.preferred()
  const shellName = path.basename(shellPath).toLowerCase()

  try {
    switch (shellName) {
      case "bash":
        return await getBashCommandCompletions(prefix, cwd)
      case "zsh":
        return await getZshCommandCompletions(prefix, cwd)
      case "fish":
        return await getFishCommandCompletions(prefix, cwd)
      default:
        // Fallback: just do file completion + PATH search
        return await getFallbackCommandCompletions(prefix, cwd)
    }
  } catch (error) {
    return await getFallbackCommandCompletions(prefix, cwd)
  }
}

/**
 * Bash command completions using compgen.
 */
async function getBashCommandCompletions(prefix: string, cwd: string): Promise<string[]> {
  return new Promise((resolve) => {
    // Use compgen -c for commands (includes aliases, functions, builtins, and executables)
    const proc = spawn("bash", ["-c", `compgen -c -- ${escapeShellArg(prefix)}`], {
      cwd,
      env: { ...process.env, TERM: "dumb" },
      timeout: 2000,
    })

    let output = ""
    proc.stdout?.on("data", (data) => {
      output += data.toString()
    })

    proc.on("close", () => {
      const completions = output
        .split("\n")
        .filter((line) => line.length > 0)
        .sort()
      resolve(dedupeAndLimit(completions))
    })

    proc.on("error", () => {
      resolve([])
    })

    setTimeout(() => {
      proc.kill()
      resolve([])
    }, 2000)
  })
}

/**
 * Zsh command completions.
 */
async function getZshCommandCompletions(prefix: string, cwd: string): Promise<string[]> {
  return new Promise((resolve) => {
    // Zsh doesn't have compgen, but we can use a similar approach
    const script = `
      autoload -Uz compinit 2>/dev/null
      compinit -u 2>/dev/null
      # Get commands matching prefix
      print -l \${(k)commands[(I)${escapeZshPattern(prefix)}*]} \${(k)aliases[(I)${escapeZshPattern(prefix)}*]} \${(k)functions[(I)${escapeZshPattern(prefix)}*]} \${(k)builtins[(I)${escapeZshPattern(prefix)}*]} 2>/dev/null | sort -u
    `
    const proc = spawn("zsh", ["-c", script], {
      cwd,
      env: { ...process.env, TERM: "dumb" },
      timeout: 2000,
    })

    let output = ""
    proc.stdout?.on("data", (data) => {
      output += data.toString()
    })

    proc.on("close", () => {
      const completions = output
        .split("\n")
        .filter((line) => line.length > 0)
        .sort()
      resolve(dedupeAndLimit(completions))
    })

    proc.on("error", () => {
      resolve([])
    })

    setTimeout(() => {
      proc.kill()
      resolve([])
    }, 2000)
  })
}

/**
 * Fish command completions.
 */
async function getFishCommandCompletions(prefix: string, cwd: string): Promise<string[]> {
  return new Promise((resolve) => {
    // Fish has a built-in complete command
    const proc = spawn("fish", ["-c", `complete -C ${escapeShellArg(prefix)}`], {
      cwd,
      env: { ...process.env, TERM: "dumb" },
      timeout: 2000,
    })

    let output = ""
    proc.stdout?.on("data", (data) => {
      output += data.toString()
    })

    proc.on("close", () => {
      const completions = output
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => line.split("\t")[0] ?? "") // Fish returns "completion\tdescription"
        .filter((c) => c.length > 0)
        .sort()
      resolve(dedupeAndLimit(completions))
    })

    proc.on("error", () => {
      resolve([])
    })

    setTimeout(() => {
      proc.kill()
      resolve([])
    }, 2000)
  })
}

/**
 * Fallback command completions - search PATH for executables.
 */
async function getFallbackCommandCompletions(prefix: string, cwd: string): Promise<string[]> {
  const completions: string[] = []
  const pathDirs = (process.env.PATH || "").split(path.delimiter)

  for (const dir of pathDirs) {
    try {
      const files = await fs.promises.readdir(dir)
      for (const file of files) {
        if (file.startsWith(prefix)) {
          completions.push(file)
        }
      }
    } catch {
      // Ignore unreadable directories
    }
  }

  return dedupeAndLimit(completions.sort())
}

/**
 * Get file path completions.
 */
async function getFileCompletions(prefix: string, cwd: string): Promise<string[]> {
  // Determine the directory to search and the partial filename
  let searchDir: string
  let partial: string

  if (prefix.includes("/")) {
    const lastSlash = prefix.lastIndexOf("/")
    const dirPart = prefix.slice(0, lastSlash + 1)
    partial = prefix.slice(lastSlash + 1)

    // Resolve the directory path
    if (path.isAbsolute(dirPart)) {
      searchDir = dirPart
    } else {
      searchDir = path.resolve(cwd, dirPart)
    }
  } else {
    searchDir = cwd
    partial = prefix
  }

  try {
    const entries = await fs.promises.readdir(searchDir, { withFileTypes: true })
    const completions: string[] = []

    for (const entry of entries) {
      if (entry.name.startsWith(partial)) {
        // Build the completion string
        let completion: string
        if (prefix.includes("/")) {
          const lastSlash = prefix.lastIndexOf("/")
          const dirPart = prefix.slice(0, lastSlash + 1)
          completion = dirPart + entry.name
        } else {
          completion = entry.name
        }

        // Add trailing slash for directories
        if (entry.isDirectory()) {
          completion += "/"
        }

        completions.push(completion)
      }
    }

    return completions.sort()
  } catch {
    return []
  }
}

/**
 * Find the common prefix among a list of completions.
 */
export function findCommonPrefix(completions: string[]): string {
  if (completions.length === 0) return ""
  const first = completions[0]
  if (first === undefined) return ""
  if (completions.length === 1) return first

  let prefix = first
  for (let i = 1; i < completions.length; i++) {
    const current = completions[i]
    if (current === undefined) continue
    while (!current.startsWith(prefix)) {
      prefix = prefix.slice(0, -1)
      if (prefix === "") return ""
    }
  }
  return prefix
}

/**
 * Apply a completion to the input string.
 */
export function applyCompletion(
  input: string,
  completion: string,
  replaceFrom: number,
  replaceTo: number
): string {
  const before = input.slice(0, replaceFrom)
  const after = input.slice(replaceTo)

  // Escape spaces in file paths
  const escapedCompletion = completion.includes(" ") ? escapeSpaces(completion) : completion

  return before + escapedCompletion + after
}

/**
 * Escape spaces in a path for shell usage.
 */
function escapeSpaces(s: string): string {
  return s.replace(/ /g, "\\ ")
}

/**
 * Escape a string for use as a shell argument.
 */
function escapeShellArg(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'"
}

/**
 * Escape a string for use in a zsh pattern.
 */
function escapeZshPattern(s: string): string {
  return s.replace(/[[\]{}()*+?.\\^$|]/g, "\\$&")
}

/**
 * Dedupe and limit completions to a reasonable number.
 */
function dedupeAndLimit(completions: string[], limit = 100): string[] {
  const unique = [...new Set(completions)]
  return unique.slice(0, limit)
}
