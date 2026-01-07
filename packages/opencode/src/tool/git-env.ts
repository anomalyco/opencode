/**
 * Git-specific environment builder
 *
 * Purpose: Build a clean environment for Git operations by filtering IDE-specific
 * variables and ensuring Git-specific variables are set.
 */

import path from "path"

// IDE-specific variables to remove
const IDE_VARIABLES = [
  "TERM_PROGRAM",
  "TERM_PROGRAM_VERSION",
  "VSCODE_INJECTION",
  "GIT_ASKPASS",
  "GIT_ASKPASS_COMPLETE",
  "VSCODE_GIT_ASKPASS_WINDOW",
  "ELECTRON_RUN_AS_NODE",
  "ELECTRON_NO_ATTACH_CONSOLE",
]

// Essential user variables to preserve
const ESSENTIAL_VARIABLES = [
  "PATH",
  "HOME",
  "USER",
  "SHELL",
  "TERM",
]

// Git-specific variables to set on Windows
const GIT_WINDOWS_VARIABLES: Record<string, string> = {
  MSYSTEM: "MINGW64",
  MSYS2_PATH_TYPE: "inherit",
  GIT_TERMINAL_PROMPT: "0",
}

/**
 * Build a clean environment for Git operations
 * @param inputEnv - Optional input environment (defaults to process.env)
 * @returns Cleaned environment object
 */
export function buildGitEnv(inputEnv?: Record<string, string>): NodeJS.ProcessEnv {
  const env = inputEnv ?? process.env

  // Start with essential variables preserved
  const result: Record<string, string> = {}

  for (const key of ESSENTIAL_VARIABLES) {
    if (env[key] !== undefined) {
      result[key] = env[key]
    }
  }

  // Copy all other variables except IDE-specific ones
  for (const [key, value] of Object.entries(env)) {
    if (!IDE_VARIABLES.includes(key)) {
      result[key] = value
    }
  }

  // Set Git-specific variables on Windows
  if (process.platform === "win32") {
    for (const [key, value] of Object.entries(GIT_WINDOWS_VARIABLES)) {
      result[key] = value
    }

    // Ensure PATH includes Git binaries on Windows
    const gitPaths = [
      path.join(process.env.PROGRAMFILES ?? "C:\\Program Files", "Git", "bin"),
      path.join(process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)", "Git", "bin"),
      path.join(process.env.LOCALAPPDATA ?? "", "Programs", "Git", "bin"),
    ]

    const existingPath = result.PATH ?? ""
    const additionalPaths = gitPaths.filter((p) => p && !existingPath.includes(p))

    if (additionalPaths.length > 0) {
      result.PATH = [...additionalPaths, existingPath].join(path.delimiter)
    }
  }

  return result
}
