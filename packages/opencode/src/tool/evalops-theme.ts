/**
 * EvalOps Theme & Branding
 * 🎯 Visual identity for EvalOps integration
 */

export namespace EvalOpsTheme {
  // Brand colors
  export const colors = {
    primary: {
      50: "#EEF2FF",
      100: "#E0E7FF",
      200: "#C7D2FE",
      300: "#A5B4FC",
      400: "#818CF8",
      500: "#6366F1", // Main brand color
      600: "#4F46E5",
      700: "#4338CA",
      800: "#3730A3",
      900: "#312E81",
    },
    success: {
      light: "#D1FAE5",
      DEFAULT: "#10B981",
      dark: "#059669",
    },
    warning: {
      light: "#FEF3C7",
      DEFAULT: "#F59E0B",
      dark: "#D97706",
    },
    danger: {
      light: "#FEE2E2",
      DEFAULT: "#EF4444",
      dark: "#DC2626",
    },
    neutral: {
      50: "#F9FAFB",
      100: "#F3F4F6",
      200: "#E5E7EB",
      300: "#D1D5DB",
      400: "#9CA3AF",
      500: "#6B7280",
      600: "#4B5563",
      700: "#374151",
      800: "#1F2937",
      900: "#111827",
    },
  } as const

  // Brand elements
  export const brand = {
    name: "EvalOps",
    tagline: "Trust, but Verify",
    logo: "🎯",
    version: "1.0.0",
    website: "https://evalops.ai",
  } as const

  // UI components styling
  export const components = {
    badge: {
      success: "bg-green-100 text-green-800 px-2 py-1 rounded-full text-xs font-semibold",
      warning: "bg-amber-100 text-amber-800 px-2 py-1 rounded-full text-xs font-semibold",
      danger: "bg-red-100 text-red-800 px-2 py-1 rounded-full text-xs font-semibold",
      info: "bg-indigo-100 text-indigo-800 px-2 py-1 rounded-full text-xs font-semibold",
    },
    button: {
      primary: "bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2 px-4 rounded-lg transition-colors",
      secondary: "bg-gray-200 hover:bg-gray-300 text-gray-800 font-medium py-2 px-4 rounded-lg transition-colors",
      danger: "bg-red-600 hover:bg-red-700 text-white font-medium py-2 px-4 rounded-lg transition-colors",
    },
    card: {
      DEFAULT: "bg-white rounded-xl shadow-sm border border-gray-200 p-6",
      dark: "bg-gray-800 rounded-xl shadow-lg border border-gray-700 p-6",
      branded: "bg-gradient-to-br from-indigo-500 to-purple-600 text-white rounded-xl shadow-xl p-6",
    },
    status: {
      running: "animate-pulse text-indigo-600",
      success: "text-green-600",
      failed: "text-red-600",
      pending: "text-gray-400",
    },
  } as const

  // Terminal/TUI theme
  export const terminal = {
    // ANSI color codes
    reset: "\x1b[0m",
    bold: "\x1b[1m",
    dim: "\x1b[2m",

    // Foreground colors
    fg: {
      primary: "\x1b[38;5;99m", // Indigo
      success: "\x1b[38;5;42m", // Green
      warning: "\x1b[38;5;214m", // Orange
      danger: "\x1b[38;5;196m", // Red
      info: "\x1b[38;5;33m", // Blue
      muted: "\x1b[38;5;245m", // Gray
    },

    // Background colors
    bg: {
      primary: "\x1b[48;5;99m",
      success: "\x1b[48;5;42m",
      warning: "\x1b[48;5;214m",
      danger: "\x1b[48;5;196m",
      dark: "\x1b[48;5;236m",
    },

    // Styled components
    header: (text: string) => `${terminal.bold}${terminal.fg.primary}${brand.logo} ${text}${terminal.reset}`,

    success: (text: string) => `${terminal.fg.success}✅ ${text}${terminal.reset}`,

    error: (text: string) => `${terminal.fg.danger}❌ ${text}${terminal.reset}`,

    warning: (text: string) => `${terminal.fg.warning}⚠️  ${text}${terminal.reset}`,

    info: (text: string) => `${terminal.fg.info}ℹ️  ${text}${terminal.reset}`,

    muted: (text: string) => `${terminal.fg.muted}${text}${terminal.reset}`,

    brand: () =>
      `${terminal.bold}${terminal.fg.primary}${brand.logo} ${brand.name}${terminal.reset} - ${terminal.dim}"${brand.tagline}"${terminal.reset}`,
  } as const

  // ASCII art logo for terminal
  export const ascii = `
${terminal.fg.primary}
███████╗██╗   ██╗ █████╗ ██╗      ██████╗ ██████╗ ███████╗
██╔════╝██║   ██║██╔══██╗██║     ██╔═══██╗██╔══██╗██╔════╝
█████╗  ██║   ██║███████║██║     ██║   ██║██████╔╝███████╗
██╔══╝  ╚██╗ ██╔╝██╔══██║██║     ██║   ██║██╔═══╝ ╚════██║
███████╗ ╚████╔╝ ██║  ██║███████╗╚██████╔╝██║     ███████║
╚══════╝  ╚═══╝  ╚═╝  ╚═╝╚══════╝ ╚═════╝ ╚═╝     ╚══════╝
${terminal.reset}
${terminal.dim}Trust, but Verify™${terminal.reset}
`

  // Evaluation result formatting
  export function formatScore(score: number): string {
    let color: string = terminal.fg.danger
    let emoji = "🔴"

    if (score >= 90) {
      color = terminal.fg.success
      emoji = "🟢"
    } else if (score >= 70) {
      color = terminal.fg.success // Use consistent type
      emoji = "🟡"
    } else if (score >= 50) {
      color = terminal.fg.warning
      emoji = "🟠"
    }

    return `${color}${emoji} ${score.toFixed(1)}%${terminal.reset}`
  }

  export function formatTestResult(name: string, passed: boolean, duration: number): string {
    const status = passed ? terminal.success("PASS") : terminal.error("FAIL")
    const time = terminal.muted(`(${duration}ms)`)
    return `  ${status} ${name} ${time}`
  }

  export function formatSummary(passed: number, total: number, duration: number): string {
    const score = (passed / total) * 100
    const scoreStr = formatScore(score)
    const timeStr = terminal.muted(`in ${duration}ms`)

    return `
${terminal.header("Evaluation Summary")}
  Tests:    ${passed}/${total} passed
  Score:    ${scoreStr}
  Duration: ${timeStr}

${terminal.brand()}
`
  }

  // Progress indicators
  export const progress = {
    spinner: ["🎯", "🎯.", "🎯..", "🎯..."],
    bar: (current: number, total: number, width = 20) => {
      const percentage = current / total
      const filled = Math.floor(percentage * width)
      const empty = width - filled

      const bar = "█".repeat(filled) + "░".repeat(empty)
      const color =
        percentage >= 0.8 ? terminal.fg.success : percentage >= 0.5 ? terminal.fg.warning : terminal.fg.danger

      return `${color}[${bar}]${terminal.reset} ${formatScore(percentage * 100)}`
    },
  } as const

  // Messages
  export const messages = {
    welcome: () => `
${ascii}

${terminal.header("Welcome to EvalOps for OpenCode")}

Continuous evaluation and testing for AI-generated code.
Run ${terminal.fg.info}evalops${terminal.reset} tool to start an evaluation.

${terminal.muted("Documentation: https://evalops.ai/docs")}
`,

    starting: (suite: string) => `${terminal.header(`Starting evaluation: ${suite}`)}`,

    completed: (suite: string, score: number) =>
      `${terminal.header(`Evaluation complete: ${suite}`)} ${formatScore(score)}`,

    failed: (error: string) => `${terminal.error(`Evaluation failed: ${error}`)}`,

    disabled: () => `${terminal.warning("EvalOps is disabled. Enable it in your configuration.")}`,
  } as const
}

// Export convenience functions
export const theme = EvalOpsTheme
export const colors = EvalOpsTheme.colors
export const brand = EvalOpsTheme.brand
export const terminal = EvalOpsTheme.terminal
