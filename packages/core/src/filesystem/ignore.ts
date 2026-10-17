// Default ignore set for recursive workspace watches. Every entry must name a
// directory or file that is never source worth watching: dependency installs,
// build output, caches, or VCS internals. Names that legitimately hold source
// in real projects (for example "vendor", "bin", or "desktop") do not belong
// here, no matter how often they are generated elsewhere.
const FOLDERS = new Set([
  // Dependency installs
  "node_modules",
  "bower_components",
  ".pnpm-store",
  ".npm",
  // Virtual environments
  ".venv",
  "venv",
  // Build output
  "dist",
  "build",
  "out",
  ".output",
  ".next",
  ".turbo",
  ".sst",
  "target",
  "coverage",
  ".nyc_output",
  // Caches
  ".cache",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  ".gradle",
  // VCS internals
  ".git",
  ".svn",
  ".hg",
  // Editor state
  ".vscode",
  ".idea",
  ".history",
])

const FILES = [
  "**/*.swp",
  "**/*.swo",
  "**/*.pyc",
  "**/.DS_Store",
  "**/Thumbs.db",
  "**/*.log",
]

export const PATTERNS = [...FILES, ...FOLDERS, `**/{${Array.from(FOLDERS).join(",")}}/**`]

export * as Ignore from "./ignore.js"
