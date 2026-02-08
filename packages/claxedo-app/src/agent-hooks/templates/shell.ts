/**
 * Shell Integration Templates
 *
 * Generates shell configuration files that inject Claxedo's
 * wrapper scripts into PATH via ZDOTDIR (zsh) and BASH_ENV (bash).
 */

import { BIN_DIR, SHELL_DIR, SHELL_MARKER } from "../constants"

/**
 * Generate .zshrc for custom ZDOTDIR
 * Sources user's original config, then prepends our bin to PATH
 */
export function generateZshrc(): string {
  return `${SHELL_MARKER}
# Claxedo zsh configuration
# Sources user's original config, then adds agent wrappers to PATH

# Determine user's original ZDOTDIR (or HOME)
_CLAXEDO_ORIG_ZDOTDIR="\${CLAXEDO_ORIG_ZDOTDIR:-$HOME}"

# Source user's .zshenv if it exists (sets up base environment)
if [ -f "$_CLAXEDO_ORIG_ZDOTDIR/.zshenv" ]; then
  source "$_CLAXEDO_ORIG_ZDOTDIR/.zshenv"
fi

# Source user's .zshrc if it exists
if [ -f "$_CLAXEDO_ORIG_ZDOTDIR/.zshrc" ]; then
  source "$_CLAXEDO_ORIG_ZDOTDIR/.zshrc"
fi

# Prepend Claxedo bin to PATH (after user's config so we take priority)
export PATH="${BIN_DIR}:\$PATH"
`
}

/**
 * Generate .zshenv for custom ZDOTDIR
 * Minimal setup to ensure ZDOTDIR propagates correctly
 */
export function generateZshenv(): string {
  return `${SHELL_MARKER}
# Claxedo zsh environment
# Preserves original ZDOTDIR for sourcing user config

# Store original ZDOTDIR if not already set
if [ -z "\${CLAXEDO_ORIG_ZDOTDIR:-}" ]; then
  export CLAXEDO_ORIG_ZDOTDIR="\${ZDOTDIR:-$HOME}"
fi
`
}

/**
 * Generate bash config for BASH_ENV
 * Sources user's bashrc, then adds our bin to PATH
 */
export function generateBashrc(): string {
  return `${SHELL_MARKER}
# Claxedo bash configuration
# Sources user's original config, then adds agent wrappers to PATH

# Source user's .bashrc if it exists
if [ -f "$HOME/.bashrc" ]; then
  source "$HOME/.bashrc"
fi

# Prepend Claxedo bin to PATH
export PATH="${BIN_DIR}:\$PATH"
`
}

/**
 * Get environment variables for zsh shell integration
 */
export function getZshEnvVars(): Record<string, string> {
  return {
    ZDOTDIR: SHELL_DIR,
    // Preserve original ZDOTDIR so we can source user's config
    CLAXEDO_ORIG_ZDOTDIR: process.env.ZDOTDIR || process.env.HOME || "",
  }
}

/**
 * Get environment variables for bash shell integration
 */
export function getBashEnvVars(): Record<string, string> {
  return {
    BASH_ENV: `${SHELL_DIR}/.bashrc`,
  }
}

/**
 * Get shell-specific environment variables based on detected shell
 */
export function getShellEnvVars(shell: string): Record<string, string> {
  const shellName = shell.split("/").pop() || ""

  if (shellName === "zsh" || shellName.includes("zsh")) {
    return getZshEnvVars()
  }

  if (shellName === "bash" || shellName.includes("bash")) {
    return getBashEnvVars()
  }

  // For other shells, just add to PATH directly
  return {
    PATH: `${BIN_DIR}:${process.env.PATH || ""}`,
  }
}
