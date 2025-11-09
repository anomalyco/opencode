/**
 * Intelligent command suggestion system with typo detection
 */

export namespace Suggestions {
  // All available commands
  const COMMANDS = [
    "run",
    "spawn",
    "attach",
    "serve",
    "auth",
    "models",
    "agent",
    "config",
    "debug",
    "mcp",
    "export",
    "import",
    "stats",
    "upgrade",
    "web",
    "github",
    "acp",
    "generate",
    "thread",
    "completion",
    "setup",
    "alias",
    "plugins",
    "openrouter",
  ]

  const SUB_COMMANDS: Record<string, string[]> = {
    auth: ["login", "logout", "list"],
    debug: ["config", "lsp", "file", "rg", "snapshot"],
    mcp: ["install", "list"],
  }

  const COMMON_FLAGS = [
    "--help",
    "-h",
    "--version",
    "-v",
    "--print-logs",
    "--log-level",
    "--model",
    "-m",
    "--agent",
    "--file",
    "-f",
    "--continue",
    "-c",
    "--session",
    "-s",
    "--format",
    "--port",
    "--hostname",
  ]

  /**
   * Calculate Levenshtein distance between two strings
   */
  function levenshteinDistance(str1: string, str2: string): number {
    const matrix: number[][] = []

    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i]
    }

    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j
    }

    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1]
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1, // substitution
            matrix[i][j - 1] + 1, // insertion
            matrix[i - 1][j] + 1, // deletion
          )
        }
      }
    }

    return matrix[str2.length][str1.length]
  }

  /**
   * Calculate similarity score between 0 and 1
   */
  function similarityScore(str1: string, str2: string): number {
    const distance = levenshteinDistance(str1.toLowerCase(), str2.toLowerCase())
    const maxLength = Math.max(str1.length, str2.length)
    return 1 - distance / maxLength
  }

  /**
   * Find similar commands based on typo
   */
  export function findSimilarCommands(input: string, threshold: number = 0.6): string[] {
    const candidates = COMMANDS.map((cmd) => ({
      command: cmd,
      score: similarityScore(input, cmd),
    }))
      .filter((c) => c.score >= threshold)
      .sort((a, b) => b.score - a.score)

    return candidates.slice(0, 5).map((c) => c.command)
  }

  /**
   * Find similar sub-commands
   */
  export function findSimilarSubCommands(
    command: string,
    input: string,
    threshold: number = 0.6,
  ): string[] {
    const subCommands = SUB_COMMANDS[command] || []
    const candidates = subCommands
      .map((cmd) => ({
        command: cmd,
        score: similarityScore(input, cmd),
      }))
      .filter((c) => c.score >= threshold)
      .sort((a, b) => b.score - a.score)

    return candidates.slice(0, 5).map((c) => c.command)
  }

  /**
   * Find similar flags
   */
  export function findSimilarFlags(input: string, threshold: number = 0.7): string[] {
    const candidates = COMMON_FLAGS.map((flag) => ({
      flag,
      score: similarityScore(input, flag),
    }))
      .filter((c) => c.score >= threshold)
      .sort((a, b) => b.score - a.score)

    return candidates.slice(0, 5).map((c) => c.flag)
  }

  /**
   * Suggest command based on partial input
   */
  export function suggestCommands(partial: string): string[] {
    if (!partial) return COMMANDS.slice(0, 10)

    const exact = COMMANDS.filter((cmd) => cmd.startsWith(partial.toLowerCase()))
    if (exact.length > 0) return exact.slice(0, 10)

    return findSimilarCommands(partial, 0.5)
  }

  /**
   * Common typos and their corrections
   */
  const COMMON_TYPOS: Record<string, string> = {
    hlep: "help",
    hepl: "help",
    hlp: "help",
    hep: "help",
    serv: "serve",
    seves: "serve",
    atach: "attach",
    atach: "attach",
    attachh: "attach",
    athc: "auth",
    ath: "auth",
    auht: "auth",
    modles: "models",
    modls: "models",
    model: "models",
    exprot: "export",
    exoprt: "export",
    imoprt: "import",
    improt: "import",
    stat: "stats",
    stas: "stats",
    upgarde: "upgrade",
    upgrad: "upgrade",
    upgade: "upgrade",
    confg: "config",
    cnfig: "config",
    conifg: "config",
    dbg: "debug",
    debg: "debug",
    dbeug: "debug",
    genrate: "generate",
    generaet: "generate",
    genearte: "generate",
    compleation: "completion",
    compltion: "completion",
    completon: "completion",
  }

  /**
   * Check for common typos and suggest correction
   */
  export function checkCommonTypo(input: string): string | null {
    return COMMON_TYPOS[input.toLowerCase()] || null
  }

  /**
   * Get contextual suggestions based on previous command
   */
  export function getContextualSuggestions(previousCommand: string | null): string[] {
    const suggestions: Record<string, string[]> = {
      auth: ["login", "logout", "list"],
      mcp: ["install", "list"],
      debug: ["config", "lsp", "file"],
      run: ["--continue", "--model", "--agent", "--file"],
      serve: ["--port", "--hostname"],
      null: COMMANDS.slice(0, 10),
    }

    return suggestions[previousCommand || "null"] || []
  }

  /**
   * Format suggestion message
   */
  export function formatSuggestion(invalid: string, suggestions: string[]): string {
    if (suggestions.length === 0) return ""

    if (suggestions.length === 1) {
      return `Did you mean '${suggestions[0]}'?`
    }

    return `Did you mean one of these?\n  ${suggestions.join("\n  ")}`
  }

  /**
   * Detect if user might be trying to use a different CLI tool
   */
  export function detectOtherCli(input: string): string | null {
    const otherCliPatterns: Record<string, string> = {
      git: "git",
      npm: "npm",
      yarn: "yarn",
      docker: "docker",
      kubectl: "kubectl",
      pnpm: "pnpm",
      bun: "bun",
      node: "node",
      python: "python",
      pip: "pip",
    }

    const detected = Object.entries(otherCliPatterns).find(([key]) => input.toLowerCase().startsWith(key))

    if (detected) {
      return `It looks like you're trying to use ${detected[1]}. OpenCode is a different CLI tool. Try 'opencode --help' for available commands.`
    }

    return null
  }

  /**
   * Provide helpful examples based on command
   */
  export function getExamples(command: string): string[] {
    const examples: Record<string, string[]> = {
      run: [
        "opencode run 'fix the bug in app.ts'",
        "opencode run --file app.ts 'add error handling'",
        "opencode run --continue",
        "opencode run --model anthropic/claude-sonnet-4.5 'explain this code'",
      ],
      spawn: ["opencode spawn", "opencode spawn --port 4096"],
      attach: ["opencode attach --url http://localhost:4096"],
      serve: ["opencode serve --port 4096", "opencode serve --hostname 0.0.0.0"],
      auth: ["opencode auth login --provider anthropic", "opencode auth list", "opencode auth logout"],
      models: ["opencode models", "opencode models --help"],
      completion: [
        'eval "$(opencode completion bash)"',
        'eval "$(opencode completion zsh)"',
        "opencode completion fish > ~/.config/fish/completions/opencode.fish",
      ],
      agent: ["opencode agent", "opencode agent --help"],
      mcp: ["opencode mcp install", "opencode mcp list"],
      debug: ["opencode debug config", "opencode debug lsp"],
    }

    return examples[command] || [`opencode ${command} --help`]
  }
}
