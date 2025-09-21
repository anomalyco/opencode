export namespace FileIgnore {
  const DEFAULT_PATTERNS = [
    // Dependencies
    "**/node_modules/**",
    "**/bower_components/**",
    "**/.pnpm-store/**",
    "**/vendor/**",

    // vcs
    "**/.git/**",

    // Build outputs
    "**/dist/**",
    "**/build/**",
    "**/out/**",
    "**/.next/**",
    "**/target/**", // Rust
    "**/bin/**",
    "**/obj/**", // .NET

    // Version control
    "**/.git/**",
    "**/.svn/**",
    "**/.hg/**",

    // IDE/Editor
    "**/.vscode/**",
    "**/.idea/**",
    "**/*.swp",
    "**/*.swo",

    // OS
    "**/.DS_Store",
    "**/Thumbs.db",

    // Logs & temp
    "**/logs/**",
    "**/tmp/**",
    "**/temp/**",
    "**/*.log",

    // Coverage/test outputs
    "**/coverage/**",
    "**/.nyc_output/**",
  ]

  const GLOBS = DEFAULT_PATTERNS.map((p) => new Bun.Glob(p))

  export function match(
    filepath: string,
    opts: {
      extra?: Bun.Glob[]
    },
  ) {
    const extra = opts.extra || []
    for (const glob of [...GLOBS, ...extra]) {
      if (glob.match(filepath)) return true
    }
    return false
  }
}
